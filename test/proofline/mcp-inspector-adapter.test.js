import test from 'node:test';
import assert from 'node:assert/strict';
import { toProoflineObservation } from '../../src/proofline/adapters/mcp-inspector.js';
import { validateProoflineEvidence } from '../../src/proofline/evidence-schema.js';

const context = { issueKey: 'PAY-142', sessionId: 'session-7' };

test('maps a sanitized successful MCP event to a schema-valid observation, never verification', () => {
  const record = toProoflineObservation({
    id: 12, event: 'rpc.response', time: '2026-11-15T08:00:00Z',
    transport: 'stdio', tool: 'run_tests', duration_ms: 42, is_error: false,
  }, context);
  assert.equal(validateProoflineEvidence(record).valid, true);
  assert.equal(record.recordType, 'observation');
  assert.equal(record.eventName, 'mcp.rpc.response');
  assert.equal(record.observationStatus, 'success');
  assert.equal(record.protocol, 'stdio');
  assert.equal(record.durationMs, 42);
  assert.equal(record.toolName, 'run_tests');
  assert.equal('outcome' in record, false);
  assert.equal('criterionKey' in record, false);
});

test('maps errors and timeouts without upgrading them to CI outcomes', () => {
  const failed = toProoflineObservation({ id: 13, event: 'rpc.response', time: '2026-11-15T08:00:00Z', is_error: true }, context);
  const timeout = toProoflineObservation({ id: 14, event: 'rpc.timeout', time: '2026-11-15T08:00:00Z' }, context);
  assert.equal(validateProoflineEvidence(failed).valid, true);
  assert.equal(validateProoflineEvidence(timeout).valid, true);
  assert.equal(failed.observationStatus, 'error');
  assert.equal(timeout.observationStatus, 'timeout');
  assert.equal(timeout.eventName, 'mcp.timeout');
});

test('ignores event types outside the explicit allowlist', () => {
  assert.equal(toProoflineObservation({ id: 1, event: 'rpc.notification' }, context), null);
});

test('rejects missing issue/session context', () => {
  assert.throws(() => toProoflineObservation({ event: 'rpc.request' }, { sessionId: 's' }), /issueKey/);
  assert.throws(() => toProoflineObservation({ event: 'rpc.request' }, { issueKey: 'PAY-1' }), /sessionId/);
});

test('does not forward arbitrary event fields or raw request payloads', () => {
  const record = toProoflineObservation({
    id: 2, event: 'rpc.request', time: '2026-11-15T08:00:00Z',
    prompt: 'secret', arguments: { token: 'secret' }, result: { secret: true },
  }, context);
  assert.equal(validateProoflineEvidence(record).valid, true);
  assert.equal('prompt' in record, false);
  assert.equal('arguments' in record, false);
  assert.equal('result' in record, false);
});
