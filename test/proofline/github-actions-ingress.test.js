import test from 'node:test';
import assert from 'node:assert/strict';
import { signProoflineRequest } from '../../src/proofline/github-actions-auth.js';
import { handleGitHubActionsIngress, StoreBusyError, StoreConflictError, parseJsonWithoutDuplicateKeys } from '../../src/proofline/github-actions-ingress.js';

const secret = 'c'.repeat(43);
const nowMs = 1_800_000_000_000;
const timestamp = String(Math.floor(nowMs / 1000));
const record = {
  schemaVersion: 1, recordType: 'verification', evidenceId: 'github-actions:123:unit-tests',
  issueKey: 'PAY-142', criterionKey: 'unit-tests', outcome: 'PASS', source: 'github-actions',
  sourceRunId: '123', observedAt: new Date(nowMs).toISOString(),
  verifier: { name: 'proofline-test', version: '1.0.0' }, summary: 'Tests passed',
};

function signedRequest(overrides = {}) {
  const body = overrides.body ?? JSON.stringify(record);
  const nonce = overrides.nonce ?? '12345678-1234-4234-8234-123456789012';
  const signature = signProoflineRequest({ secret, timestamp, nonce, body });
  return {
    method: 'POST', body,
    headers: {
      'X-Proofline-Timestamp': [timestamp],
      'X-Proofline-Nonce': [nonce],
      'X-Proofline-Signature': [`sha256=${signature}`],
      ...(overrides.headers ?? {}),
    },
  };
}
function dependencies() {
  const nonces = new Set(); const evidence = new Set();
  return {
    nowMs,
    getSecretState: async () => ({ current: secret }),
    claimNonce: async (nonce) => { if (nonces.has(nonce)) throw new StoreConflictError(); nonces.add(nonce); },
    saveEvidence: async (item) => { if (evidence.has(item.evidenceId)) throw new StoreConflictError(); evidence.add(item.evidenceId); },
    nonces, evidence,
  };
}

test('accepts signed valid evidence and stores both nonce and record', async () => {
  const deps = dependencies();
  const result = await handleGitHubActionsIngress(signedRequest(), deps);
  assert.equal(result.outputKey, 'accepted');
  assert.equal(deps.evidence.has(record.evidenceId), true);
});

test('rejects unauthenticated, duplicate nonce, duplicate evidence and unknown fields', async () => {
  const deps = dependencies();
  const request = signedRequest();
  assert.equal((await handleGitHubActionsIngress({ ...request, headers: {} }, deps)).outputKey, 'unauthorized');
  assert.equal((await handleGitHubActionsIngress(request, deps)).outputKey, 'accepted');
  assert.equal((await handleGitHubActionsIngress(request, deps)).outputKey, 'conflict');
  const duplicateEvidence = signedRequest({ nonce: '32345678-1234-4234-8234-123456789012' });
  assert.equal((await handleGitHubActionsIngress(duplicateEvidence, deps)).outputKey, 'conflict');
  const unknown = { ...record, prompt: 'must not be accepted' };
  assert.equal((await handleGitHubActionsIngress(signedRequest({ body: JSON.stringify(unknown), nonce: '22345678-1234-4234-8234-123456789012' }), deps)).outputKey, 'invalid-request');
});

test('rejects duplicate JSON keys including nested duplicates', () => {
  assert.throws(() => parseJsonWithoutDuplicateKeys('{"outcome":"PASS","outcome":"FAIL"}'), /duplicate JSON key/);
  assert.throws(() => parseJsonWithoutDuplicateKeys('{"artifact":{"uri":"a","uri":"b"}}'), /duplicate JSON key/);
  assert.deepEqual(parseJsonWithoutDuplicateKeys('{"nested":{"ok":true}}'), { nested: { ok: true } });
});

test('rejects non-POST requests and malformed evidence', async () => {
  const deps = dependencies();
  assert.equal((await handleGitHubActionsIngress({ method: 'GET' }, deps)).outputKey, 'method-not-allowed');
  const bad = { ...record, outcome: 'MAYBE' };
  assert.equal((await handleGitHubActionsIngress(signedRequest({ body: JSON.stringify(bad) }), deps)).outputKey, 'invalid-request');
});

test('returns retryable 503 when optimistic concurrency retries are exhausted', async () => {
  const deps = dependencies();
  deps.saveEvidence = async () => { throw new StoreBusyError(); };
  const result = await handleGitHubActionsIngress(signedRequest(), deps);
  assert.equal(result.outputKey, 'temporarily-unavailable');
});
