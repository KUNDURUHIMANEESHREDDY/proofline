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

async function getOrCreateIssueState(issueKey) {
  const entity = kvs.entity(ISSUE_STATE_ENTITY);
  let state = await entity.get(issueKey);
  if (state) {
    if (!Number.isInteger(state.version) || typeof state.summaryJson !== 'string') {
      throw new Error('Stored Proofline issue state is invalid');
    }
    return state;
  }
  try {
    await entity.set(issueKey, { version: 0, summaryJson: JSON.stringify(emptySummary()) }, { keyPolicy: 'FAIL_IF_EXISTS' });
  } catch (error) {
    if (!isConflict(error)) throw error;
  }
  state = await entity.get(issueKey);
  if (!state || !Number.isInteger(state.version) || typeof state.summaryJson !== 'string') {
    throw new Error('Unable to initialize Proofline issue state');
  }
  return state;
}

export async function getSecretState() {
  return (await kvs.getSecret(SECRET_KEY)) ?? null;
}

export async function saveSecretState(state) {
  await kvs.setSecret(SECRET_KEY, state, { keyPolicy: 'OVERRIDE' });
}

export async function claimNonce(nonce, nowMs) {
  try {
    await kvs.set(`proofline:nonce:${nonce}`, { claimedAt: new Date(nowMs).toISOString() }, {
      keyPolicy: 'FAIL_IF_EXISTS',
      ttl: { unit: 'MINUTES', value: NONCE_TTL_MINUTES },
    });
  } catch (error) {
    if (isConflict(error)) throw new StoreConflictError('nonce already claimed');
    throw error;
  }
}

export async function saveEvidence(record) {
  const recordKey = evidenceKey(record.issueKey, record.evidenceId);
  for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt += 1) {
    if (await kvs.entity(EVIDENCE_ENTITY).get(recordKey)) throw new StoreConflictError('evidence ID already exists');
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
      await kvs.transact()
        .set(recordKey, { recordJson: JSON.stringify(record) }, { entityName: EVIDENCE_ENTITY })
        .set(record.issueKey, {
          version: state.version + 1,
          summaryJson: JSON.stringify(nextSummary),
        }, {
          entityName: ISSUE_STATE_ENTITY,
          conditions: new Filter().and('version', FilterConditions.equalTo(state.version)),
        })
        .execute();
      return nextSummary;
    } catch (error) {
      if (await kvs.entity(EVIDENCE_ENTITY).get(recordKey)) throw new StoreConflictError('evidence ID already exists');
      const latestState = await kvs.entity(ISSUE_STATE_ENTITY).get(record.issueKey);
      if (latestState && latestState.version !== state.version) continue;
      if (!isConflict(error)) throw error;
    }
  }
  throw new StoreBusyError('concurrent evidence updates did not settle after optimistic retries');
}

export async function getIssueEvidence(issueKey) {
  const state = await kvs.entity(ISSUE_STATE_ENTITY).get(issueKey);
  const summary = state ? JSON.parse(state.summaryJson) : emptySummary();
  const ids = Array.isArray(summary.latestEvidenceIds) ? summary.latestEvidenceIds.slice(0, LATEST_EVIDENCE_LIMIT) : [];
  const values = await Promise.all(ids.map((id) => kvs.entity(EVIDENCE_ENTITY).get(evidenceKey(issueKey, id))));
  const records = values.filter(Boolean).map((value) => JSON.parse(value.recordJson));
  return {
    summary,
    records,
    incomplete: records.length !== ids.length || ids.length !== Math.min(summary.evidenceCount ?? 0, LATEST_EVIDENCE_LIMIT),
  };
}

export async function getIssuePolicy(issueKey) {
  return (await kvs.get(`proofline:policy:${issueKey}`)) ?? { requiredCriteria: [] };
}

export async function saveIssuePolicy(issueKey, policy) {
  await kvs.set(`proofline:policy:${issueKey}`, policy, { keyPolicy: 'OVERRIDE' });
}
