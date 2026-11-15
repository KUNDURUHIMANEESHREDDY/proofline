import { createHash } from 'node:crypto';
import { kvs, WhereConditions } from '@forge/kvs';
import { StoreConflictError } from './errors.js';

const SECRET_KEY = 'proofline:github-actions:hmac-secret:v1';
const NONCE_TTL_MINUTES = 10;
const PAGE_SIZE = 99;
const MAX_EVIDENCE_PAGES = 20;

function isConflict(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  const code = error?.code ?? error?.error?.code ?? '';
  const message = error?.message ?? error?.error?.message ?? error;
  return status === 409 || /conflict|already exists|fail_if_exists/i.test(`${code} ${message}`);
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
  const evidenceKey = createHash('sha256').update(record.evidenceId, 'utf8').digest('hex');
  const key = `proofline:evidence:${record.issueKey}:${evidenceKey}`;
  try {
    await kvs.set(key, record, { keyPolicy: 'FAIL_IF_EXISTS' });
  } catch (error) {
    if (isConflict(error)) throw new StoreConflictError('evidence ID already exists');
    throw error;
  }
}

export async function getIssueEvidence(issueKey) {
  const prefix = `proofline:evidence:${issueKey}:`;
  const records = [];
  let cursor;
  for (let pageNumber = 0; pageNumber < MAX_EVIDENCE_PAGES; pageNumber += 1) {
    let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(PAGE_SIZE);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    records.push(...(page.results ?? []).map((item) => item.value));
    cursor = page.nextCursor;
    if (!cursor) return { records, truncated: false };
  }
  return { records, truncated: Boolean(cursor) };
}

export async function getIssuePolicy(issueKey) {
  return (await kvs.get(`proofline:policy:${issueKey}`)) ?? { requiredCriteria: [] };
}

export async function saveIssuePolicy(issueKey, policy) {
  await kvs.set(`proofline:policy:${issueKey}`, policy, { keyPolicy: 'OVERRIDE' });
}
