import { createHash } from 'node:crypto';
import { Filter, FilterConditions, kvs } from '@forge/kvs';
import { StoreBusyError, StoreConflictError } from './errors.js';

const SECRET_KEY = 'proofline:github-actions:hmac-secret:v1';
const NONCE_TTL_MINUTES = 10;
const ISSUE_STATE_ENTITY = 'proofline-issue-state';
const EVIDENCE_ENTITY = 'proofline-evidence';
const LATEST_EVIDENCE_LIMIT = 25;
const MAX_OPTIMISTIC_RETRIES = 8;

function isConflict(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  const code = error?.code ?? error?.error?.code ?? '';
  const message = error?.message ?? error?.error?.message ?? error;
  return status === 409 || /conflict|condition.*(failed|not met)|version.*(changed|mismatch)/i.test(`${code} ${message}`);
}

function evidenceKey(issueKey, evidenceId) {
  const digest = createHash('sha256').update(evidenceId, 'utf8').digest('hex');
  return `proofline:evidence:${issueKey}:${digest}`;
}

function emptySummary() {
  return { evidenceCount: 0, byCriterion: {}, latestEvidenceIds: [] };
}

export function createForgeStore({ storage = kvs, FilterClass = Filter, filterConditions = FilterConditions } = {}) {
  async function getOrCreateIssueState(issueKey) {
    const entity = storage.entity(ISSUE_STATE_ENTITY);
    let state = await entity.get(issueKey);
    if (state) {
      if (!Number.isInteger(state.version) || typeof state.summaryJson !== 'string' || typeof state.policyJson !== 'string') {
        throw new Error('Stored Proofline issue state is invalid');
      }
      return state;
    }
    try {
      await entity.set(issueKey, { version: 0, summaryJson: JSON.stringify(emptySummary()), policyJson: JSON.stringify({ requiredCriteria: [] }) }, { keyPolicy: 'FAIL_IF_EXISTS' });
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
    state = await entity.get(issueKey);
    if (!state || !Number.isInteger(state.version) || typeof state.summaryJson !== 'string' || typeof state.policyJson !== 'string') {
      throw new Error('Unable to initialize Proofline issue state');
    }
    return state;
  }

  async function getSecretState() {
    return (await storage.getSecret(SECRET_KEY)) ?? null;
  }

  async function saveSecretState(state) {
    await storage.setSecret(SECRET_KEY, state, { keyPolicy: 'OVERRIDE' });
  }

  async function claimNonce(nonce, nowMs) {
    try {
      await storage.set(`proofline:nonce:${nonce}`, { claimedAt: new Date(nowMs).toISOString() }, {
        keyPolicy: 'FAIL_IF_EXISTS',
        ttl: { unit: 'MINUTES', value: NONCE_TTL_MINUTES },
      });
    } catch (error) {
      if (isConflict(error)) throw new StoreConflictError('nonce already claimed');
      throw error;
    }
  }

  async function saveEvidence(record) {
    const recordKey = evidenceKey(record.issueKey, record.evidenceId);
    const serializedRecord = JSON.stringify(record);
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt += 1) {
      const existing = await storage.entity(EVIDENCE_ENTITY).get(recordKey);
      if (existing) {
        if (existing.recordJson === serializedRecord) return;
        throw new StoreConflictError('evidence ID already exists with different content');
      }
      const state = await getOrCreateIssueState(record.issueKey);
      const currentSummary = JSON.parse(state.summaryJson);
      const byCriterion = { ...(currentSummary.byCriterion ?? {}) };
      const stats = { ...(byCriterion[record.criterionKey] ?? { passCount: 0, failCount: 0 }) };
      if (record.outcome === 'PASS') stats.passCount += 1;
      else stats.failCount += 1;
      stats.lastObservedAt = record.observedAt;
      byCriterion[record.criterionKey] = stats;
      const nextSummary = {
        evidenceCount: (currentSummary.evidenceCount ?? 0) + 1,
        byCriterion,
        latestEvidenceIds: [record.evidenceId, ...(currentSummary.latestEvidenceIds ?? [])].slice(0, LATEST_EVIDENCE_LIMIT),
      };

      try {
        await storage.transact()
          .set(recordKey, { recordJson: serializedRecord }, { entityName: EVIDENCE_ENTITY })
          .set(record.issueKey, {
            version: state.version + 1,
            summaryJson: JSON.stringify(nextSummary),
            policyJson: state.policyJson,
          }, {
            entityName: ISSUE_STATE_ENTITY,
            conditions: new FilterClass().and('version', filterConditions.equalTo(state.version)),
          })
          .execute();
        return nextSummary;
      } catch (error) {
        const existingAfterConflict = await storage.entity(EVIDENCE_ENTITY).get(recordKey);
        if (existingAfterConflict) {
          if (existingAfterConflict.recordJson === serializedRecord) return;
          throw new StoreConflictError('evidence ID already exists with different content');
        }
        const latestState = await storage.entity(ISSUE_STATE_ENTITY).get(record.issueKey);
        if (latestState && latestState.version !== state.version) continue;
        if (!isConflict(error)) throw error;
      }
    }
    throw new StoreBusyError('concurrent evidence updates did not settle after optimistic retries');
  }

  async function getIssueEvidence(issueKey) {
    const state = await storage.entity(ISSUE_STATE_ENTITY).get(issueKey);
    const summary = state ? JSON.parse(state.summaryJson) : emptySummary();
    const policy = state ? JSON.parse(state.policyJson) : { requiredCriteria: [] };
    const ids = Array.isArray(summary.latestEvidenceIds) ? summary.latestEvidenceIds.slice(0, LATEST_EVIDENCE_LIMIT) : [];
    const values = await Promise.all(ids.map((id) => storage.entity(EVIDENCE_ENTITY).get(evidenceKey(issueKey, id))));
    const records = values.filter(Boolean).map((value) => JSON.parse(value.recordJson));
    return {
      summary,
      policy,
      records,
      incomplete: records.length !== ids.length || ids.length !== Math.min(summary.evidenceCount ?? 0, LATEST_EVIDENCE_LIMIT),
    };
  }

  async function saveIssuePolicy(issueKey, policy) {
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt += 1) {
      const state = await getOrCreateIssueState(issueKey);
      try {
        await storage.transact()
          .set(issueKey, {
            version: state.version + 1,
            summaryJson: state.summaryJson,
            policyJson: JSON.stringify(policy),
          }, {
            entityName: ISSUE_STATE_ENTITY,
            conditions: new FilterClass().and('version', filterConditions.equalTo(state.version)),
          })
          .execute();
        return;
      } catch (error) {
        const latestState = await storage.entity(ISSUE_STATE_ENTITY).get(issueKey);
        if (latestState && latestState.version !== state.version) continue;
        if (!isConflict(error)) throw error;
      }
    }
    throw new StoreBusyError('concurrent policy updates did not settle after optimistic retries');
  }

  return { getSecretState, saveSecretState, claimNonce, saveEvidence, getIssueEvidence, saveIssuePolicy };
}

const forgeStore = createForgeStore();
export const { getSecretState, saveSecretState, claimNonce, saveEvidence, getIssueEvidence, saveIssuePolicy } = forgeStore;
