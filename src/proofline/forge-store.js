import { createHash, randomUUID } from 'node:crypto';
import { kvs } from '@forge/kvs';
import { StoreBusyError, StoreConflictError } from './errors.js';

const SECRET_KEY = 'proofline:github-actions:hmac-secret:v1';
const NONCE_TTL_MINUTES = 10;
const ISSUE_LOCK_TTL_SECONDS = 60;
const LATEST_EVIDENCE_LIMIT = 25;

function isConflict(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  const code = error?.code ?? error?.error?.code ?? '';
  const message = error?.message ?? error?.error?.message ?? error;
  return status === 409 || /conflict|already exists|fail_if_exists/i.test(`${code} ${message}`);
}

function evidenceKey(issueKey, evidenceId) {
  const digest = createHash('sha256').update(evidenceId, 'utf8').digest('hex');
  return `proofline:evidence:${issueKey}:${digest}`;
}

function summaryKey(issueKey) {
  return `proofline:issue-summary:${issueKey}`;
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
  const lockKey = `proofline:issue-lock:${record.issueKey}`;
  const lockToken = randomUUID();
  try {
    await kvs.set(lockKey, { token: lockToken, acquiredAt: new Date().toISOString() }, {
      keyPolicy: 'FAIL_IF_EXISTS',
      ttl: { unit: 'SECONDS', value: ISSUE_LOCK_TTL_SECONDS },
    });
  } catch (error) {
    if (isConflict(error)) throw new StoreBusyError('another evidence write is in progress for this issue');
    throw error;
  }

  try {
    const recordKey = evidenceKey(record.issueKey, record.evidenceId);
    if (await kvs.get(recordKey)) throw new StoreConflictError('evidence ID already exists');

    const current = await kvs.get(summaryKey(record.issueKey)) ?? {
      evidenceCount: 0,
      byCriterion: {},
      latestEvidenceIds: [],
    };
    const byCriterion = { ...(current.byCriterion ?? {}) };
    const stats = { ...(byCriterion[record.criterionKey] ?? { passCount: 0, failCount: 0 }) };
    if (record.outcome === 'PASS') stats.passCount += 1;
    else stats.failCount += 1;
    stats.lastObservedAt = record.observedAt;
    byCriterion[record.criterionKey] = stats;
    const summary = {
      evidenceCount: (current.evidenceCount ?? 0) + 1,
      byCriterion,
      latestEvidenceIds: [record.evidenceId, ...(current.latestEvidenceIds ?? [])].slice(0, LATEST_EVIDENCE_LIMIT),
      updatedAt: new Date().toISOString(),
    };

    await kvs.transact()
      .set(recordKey, record)
      .set(summaryKey(record.issueKey), summary)
      .execute();
    return summary;
  } finally {
    // The lease expires automatically if the invocation terminates unexpectedly.
    try {
      const currentLock = await kvs.get(lockKey);
      if (currentLock?.token === lockToken) await kvs.delete(lockKey);
    } catch { /* Preserve the primary operation result; the lock has a TTL. */ }
  }
}

export async function getIssueEvidence(issueKey) {
  const summary = await kvs.get(summaryKey(issueKey)) ?? {
    evidenceCount: 0,
    byCriterion: {},
    latestEvidenceIds: [],
  };
  const ids = Array.isArray(summary.latestEvidenceIds) ? summary.latestEvidenceIds.slice(0, LATEST_EVIDENCE_LIMIT) : [];
  const records = (await Promise.all(ids.map((id) => kvs.get(evidenceKey(issueKey, id))))).filter(Boolean);
  return { summary, records };
}

export async function getIssuePolicy(issueKey) {
  return (await kvs.get(`proofline:policy:${issueKey}`)) ?? { requiredCriteria: [] };
}

export async function saveIssuePolicy(issueKey, policy) {
  await kvs.set(`proofline:policy:${issueKey}`, policy, { keyPolicy: 'OVERRIDE' });
}
