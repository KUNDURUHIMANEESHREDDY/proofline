import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveVerdict, VerdictStatus, EvidenceOutcome } from '../../src/proofline/verdict.js';

const evidence = (evidenceId, criterion, outcome = EvidenceOutcome.PASS) => ({
  evidenceId, criterion, outcome, source: 'github-actions', observedAt: '2026-11-15T08:00:00Z',
});

test('all required criteria passing derives PASS', () => {
  const result = deriveVerdict(['build', 'unit-tests'], [evidence('e1', 'build'), evidence('e2', 'unit-tests')]);
  assert.equal(result.status, VerdictStatus.PASS);
  assert.deepEqual(result.evidenceIds, ['e1', 'e2']);
});

test('missing evidence derives INDETERMINATE', () => {
  const result = deriveVerdict(['build', 'security'], [evidence('e1', 'build')]);
  assert.equal(result.status, VerdictStatus.INDETERMINATE);
  assert.deepEqual(result.missingCriteria, ['security']);
});

test('any required failure wins over pass and missing evidence', () => {
  const result = deriveVerdict(['build', 'security'], [evidence('e1', 'build'), evidence('e2', 'security', EvidenceOutcome.FAIL)]);
  assert.equal(result.status, VerdictStatus.FAIL);
  assert.deepEqual(result.failedCriteria, ['security']);
});

test('conflicting evidence preserves both IDs and failure wins', () => {
  const result = deriveVerdict(['security'], [evidence('pass', 'security'), evidence('fail', 'security', EvidenceOutcome.FAIL)]);
  assert.equal(result.status, VerdictStatus.FAIL);
  assert.deepEqual(result.evidenceIds, ['fail', 'pass']);
});

test('empty policy is INDETERMINATE, not vacuous PASS', () => {
  const result = deriveVerdict([], [evidence('orphan', 'unconfigured')]);
  assert.equal(result.status, VerdictStatus.INDETERMINATE);
  assert.deepEqual(result.unmatchedCriteria, ['unconfigured']);
  assert.deepEqual(result.evidenceIds, []);
});

test('unconfigured evidence is unmatched and cannot satisfy required criteria', () => {
  const result = deriveVerdict(['build'], [evidence('orphan', 'tests')]);
  assert.equal(result.status, VerdictStatus.INDETERMINATE);
  assert.deepEqual(result.unmatchedCriteria, ['tests']);
});

test('rejects duplicate evidence IDs, duplicate criteria, and timezone-naive timestamps', () => {
  assert.throws(() => deriveVerdict(['build'], [evidence('same', 'build'), evidence('same', 'build')]), /duplicate evidenceId/);
  assert.throws(() => deriveVerdict(['build', 'build'], []), /unique/);
  assert.throws(() => deriveVerdict(['build'], [{ ...evidence('e1', 'build'), observedAt: '2026-11-15T08:00:00' }]), /timezone-aware/);
});
