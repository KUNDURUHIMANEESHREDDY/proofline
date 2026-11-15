import test from 'node:test';
import assert from 'node:assert/strict';
import { signProoflineRequest, verifyProoflineRequest } from '../../src/proofline/github-actions-auth.js';

const secret = 'a'.repeat(43);
const nowMs = 1_800_000_000_000;
const timestamp = String(Math.floor(nowMs / 1000));
const nonce = '12345678-1234-4234-8234-123456789012';
const body = '{"hello":"proofline"}';
const signature = `sha256=${signProoflineRequest({ secret, timestamp, nonce, body })}`;

test('accepts a valid timestamped HMAC request', () => {
  assert.deepEqual(verifyProoflineRequest({ secretState: { current: secret }, timestamp, nonce, signature, body, nowMs }), { valid: true });
});

test('rejects modified body, invalid signature and stale timestamps', () => {
  assert.equal(verifyProoflineRequest({ secretState: { current: secret }, timestamp, nonce, signature, body: `${body} `, nowMs }).valid, false);
  assert.equal(verifyProoflineRequest({ secretState: { current: secret }, timestamp, nonce, signature: 'sha256=' + '0'.repeat(64), body, nowMs }).valid, false);
  assert.equal(verifyProoflineRequest({ secretState: { current: secret }, timestamp: String(Number(timestamp) - 600), nonce, signature, body, nowMs }).reason, 'stale_timestamp');
});

test('accepts a previous secret only during its rotation grace period', () => {
  const oldSignature = `sha256=${signProoflineRequest({ secret, timestamp, nonce, body })}`;
  const state = { current: 'b'.repeat(43), previous: { secret, validUntil: nowMs + 1000 } };
  assert.equal(verifyProoflineRequest({ secretState: state, timestamp, nonce, signature: oldSignature, body, nowMs }).valid, true);
  assert.equal(verifyProoflineRequest({ secretState: { ...state, previous: { secret, validUntil: nowMs - 1 } }, timestamp, nonce, signature: oldSignature, body, nowMs }).valid, false);
});
