import { MAX_BODY_BYTES, verifyProoflineRequest } from './github-actions-auth.js';
import { StoreBusyError, StoreConflictError } from './errors.js';
export { StoreBusyError, StoreConflictError } from './errors.js';

const ALLOWED_FIELDS = new Set([
  'schemaVersion', 'recordType', 'evidenceId', 'issueKey', 'source', 'sourceRunId',
  'observedAt', 'verifier', 'summary', 'artifact', 'criterionKey', 'outcome',
]);
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/;
const EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/;
const CRITERION_KEY = /^[a-z][a-z0-9._-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FUTURE_OBSERVED_MS = 5 * 60 * 1000;

function parseHeaders(headers = {}) {
  const normalized = new Map();
  for (const [name, raw] of Object.entries(headers)) {
    const key = name.toLowerCase();
    const values = Array.isArray(raw) ? raw : [raw];
    if (normalized.has(key)) normalized.set(key, [...normalized.get(key), ...values]);
    else normalized.set(key, values);
  }
  return normalized;
}

function oneHeader(headers, name) {
  const values = headers.get(name.toLowerCase());
  return values?.length === 1 && typeof values[0] === 'string' ? values[0] : null;
}

function parseJsonString(text, cursor) {
  const start = cursor.index;
  if (text[cursor.index] !== '"') throw new SyntaxError('expected JSON string');
  cursor.index += 1;
  while (cursor.index < text.length) {
    const code = text.charCodeAt(cursor.index);
    if (code === 0x22) {
      cursor.index += 1;
      return JSON.parse(text.slice(start, cursor.index));
    }
    if (code < 0x20) throw new SyntaxError('control character in JSON string');
    if (code === 0x5c) {
      cursor.index += 1;
      if (cursor.index >= text.length) throw new SyntaxError('unterminated JSON escape');
    }
    cursor.index += 1;
  }
  throw new SyntaxError('unterminated JSON string');
}

function skipWhitespace(text, cursor) {
  while (cursor.index < text.length && /\s/.test(text[cursor.index])) cursor.index += 1;
}

function parseJsonValue(text, cursor, depth) {
  if (depth > 32) throw new SyntaxError('JSON nesting limit exceeded');
  skipWhitespace(text, cursor);
  const char = text[cursor.index];
  if (char === '"') { parseJsonString(text, cursor); return; }
  if (char === '{') {
    cursor.index += 1;
    skipWhitespace(text, cursor);
    const keys = new Set();
    if (text[cursor.index] === '}') { cursor.index += 1; return; }
    while (cursor.index < text.length) {
      skipWhitespace(text, cursor);
      const key = parseJsonString(text, cursor);
      if (keys.has(key)) throw new SyntaxError(`duplicate JSON key: ${key}`);
      keys.add(key);
      skipWhitespace(text, cursor);
      if (text[cursor.index++] !== ':') throw new SyntaxError('expected colon');
      parseJsonValue(text, cursor, depth + 1);
      skipWhitespace(text, cursor);
      const delimiter = text[cursor.index++];
      if (delimiter === '}') return;
      if (delimiter !== ',') throw new SyntaxError('expected comma or object end');
    }
    throw new SyntaxError('unterminated JSON object');
  }
  if (char === '[') {
    cursor.index += 1;
    skipWhitespace(text, cursor);
    if (text[cursor.index] === ']') { cursor.index += 1; return; }
    while (cursor.index < text.length) {
      parseJsonValue(text, cursor, depth + 1);
      skipWhitespace(text, cursor);
      const delimiter = text[cursor.index++];
      if (delimiter === ']') return;
      if (delimiter !== ',') throw new SyntaxError('expected comma or array end');
    }
    throw new SyntaxError('unterminated JSON array');
  }
  const rest = text.slice(cursor.index);
  const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest);
  if (!primitive) throw new SyntaxError('invalid JSON value');
  cursor.index += primitive[0].length;
}

export function parseJsonWithoutDuplicateKeys(text) {
  const cursor = { index: 0 };
  parseJsonValue(text, cursor, 0);
  skipWhitespace(text, cursor);
  if (cursor.index !== text.length) throw new SyntaxError('unexpected trailing JSON content');
  return JSON.parse(text);
}

export function validateGitHubActionsEvidence(record, nowMs = Date.now()) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'body_must_be_object';
  for (const key of Object.keys(record)) if (!ALLOWED_FIELDS.has(key)) return `unknown_field:${key}`;
  if (record.schemaVersion !== 1 || record.recordType !== 'verification' || record.source !== 'github-actions') return 'invalid_record_type';
  if (typeof record.evidenceId !== 'string' || !EVIDENCE_ID.test(record.evidenceId)) return 'invalid_evidence_id';
  if (typeof record.issueKey !== 'string' || !ISSUE_KEY.test(record.issueKey)) return 'invalid_issue_key';
  if (typeof record.criterionKey !== 'string' || !CRITERION_KEY.test(record.criterionKey)) return 'invalid_criterion_key';
  if (!['PASS', 'FAIL'].includes(record.outcome)) return 'invalid_outcome';
  if (typeof record.sourceRunId !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(record.sourceRunId)) return 'invalid_source_run_id';
  if (typeof record.observedAt !== 'string' || !Number.isFinite(Date.parse(record.observedAt)) ||
      !/(Z|[+-]\d{2}:?\d{2})$/i.test(record.observedAt)) return 'invalid_observed_at';
  if (Date.parse(record.observedAt) > nowMs + MAX_FUTURE_OBSERVED_MS) return 'observed_at_in_future';
  if (!record.verifier || typeof record.verifier !== 'object' || Array.isArray(record.verifier) ||
      Object.keys(record.verifier).some((key) => !['name', 'version'].includes(key)) ||
      typeof record.verifier.name !== 'string' || !record.verifier.name.trim() || record.verifier.name.length > 120 ||
      typeof record.verifier.version !== 'string' || !record.verifier.version.trim() || record.verifier.version.length > 80) return 'invalid_verifier';
  if (record.summary !== undefined && (typeof record.summary !== 'string' || record.summary.length > 500)) return 'invalid_summary';
  if (record.artifact !== undefined) {
    if (!record.artifact || typeof record.artifact !== 'object' || Array.isArray(record.artifact) ||
        Object.keys(record.artifact).some((key) => !['uri', 'sha256'].includes(key)) ||
        typeof record.artifact.uri !== 'string' || !record.artifact.uri.startsWith('https://') ||
        !SHA256.test(record.artifact.sha256 ?? '')) return 'invalid_artifact';
    try { if (new URL(record.artifact.uri).protocol !== 'https:') return 'invalid_artifact'; }
    catch { return 'invalid_artifact'; }
  }
  return null;
}

function response(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(payload) };
}

export async function handleGitHubActionsIngress(request, dependencies) {
  const nowMs = dependencies.nowMs ?? Date.now();
  if (request?.method !== 'POST') return response(405, { error: 'method_not_allowed' });
  if (typeof request.body !== 'string' || Buffer.byteLength(request.body, 'utf8') > MAX_BODY_BYTES) {
    return response(413, { error: 'payload_too_large_or_missing' });
  }
  const headers = parseHeaders(request.headers);
  const timestamp = oneHeader(headers, 'x-proofline-timestamp');
  const nonce = oneHeader(headers, 'x-proofline-nonce');
  const signature = oneHeader(headers, 'x-proofline-signature');
  const secretState = await dependencies.getSecretState();
  const auth = verifyProoflineRequest({ secretState, timestamp, nonce, signature, body: request.body, nowMs });
  if (!auth.valid) return response(401, { error: 'unauthorized' });

  let record;
  try { record = parseJsonWithoutDuplicateKeys(request.body); }
  catch { return response(400, { error: 'invalid_json' }); }
  const validationError = validateGitHubActionsEvidence(record, nowMs);
  if (validationError) return response(400, { error: 'invalid_evidence', reason: validationError });

  try {
    await dependencies.claimNonce(nonce, nowMs);
  } catch (error) {
    if (error instanceof StoreConflictError) return response(409, { error: 'replay_detected' });
    throw error;
  }
  try {
    await dependencies.saveEvidence(record);
  } catch (error) {
    if (error instanceof StoreConflictError) return response(409, { error: 'duplicate_evidence' });
    if (error instanceof StoreBusyError) return response(503, { error: 'temporarily_unavailable' });
    throw error;
  }
  return response(201, { accepted: true, evidenceId: record.evidenceId });
}
