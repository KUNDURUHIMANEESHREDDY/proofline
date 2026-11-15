import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveVerdictFromSummary } from '../../src/proofline/verdict.js';

const observedAt = '2026-11-15T08:00:00Z';
const summary = (byCriterion, latestEvidenceIds = ['e1'], evidenceCount = undefined) => ({
  byCriterion: Object.fromEntries(Object.entries(byCriterion).map(([key, counts]) => [key, { ...counts, lastObservedAt: observedAt }])),
  latestEvidenceIds,
  evidenceCount: evidenceCount ?? Object.values(byCriterion).reduce((sum, counts) => sum + counts.passCount + counts.failCount, 0),
});

test('summary derives PASS only when every required criterion has passing evidence', () => {
  assert.equal(deriveVerdictFromSummary(['build', 'unit-tests'], summary({
    build: { passCount: 1, failCount: 0 },
    'unit-tests': { passCount: 2, failCount: 0 },
  })).status, 'PASS');
});

test('summary keeps failure precedence and missing evidence indeterminate', () => {
  const failed = deriveVerdictFromSummary(['build', 'security'], summary({
    build: { passCount: 1, failCount: 0 },
    security: { passCount: 1, failCount: 1 },
  }));
  assert.equal(failed.status, 'FAIL');
  const missing = deriveVerdictFromSummary(['build', 'security'], summary({
    build: { passCount: 1, failCount: 0 },
  }));
  assert.equal(missing.status, 'INDETERMINATE');
  assert.deepEqual(missing.missingCriteria, ['security']);
});

test('summary retains unmatched criteria and empty policy is never PASS', () => {
  const unmatched = deriveVerdictFromSummary(['build'], summary({
    build: { passCount: 1, failCount: 0 },
    'unconfigured-check': { passCount: 1, failCount: 0 },
  }));
  assert.equal(unmatched.status, 'PASS');
  assert.deepEqual(unmatched.unmatchedCriteria, ['unconfigured-check']);
  assert.equal(deriveVerdictFromSummary([], summary({ build: { passCount: 1, failCount: 0 } })).status, 'INDETERMINATE');
});

test('summary verdict exposes only bounded recent evidence IDs and total count', () => {
  const result = deriveVerdictFromSummary(['build'], summary({ build: { passCount: 101, failCount: 0 } }, ['e1', 'e2'], 101));
  assert.deepEqual(result.evidenceIds, ['e1', 'e2']);
  assert.equal(result.evidenceIdCount, 101);
});

test('rejects an inconsistent summary rather than deriving a verdict', () => {
  assert.throws(() => deriveVerdictFromSummary(['build'], summary({
    build: { passCount: 1, failCount: 0 },
  }, ['e1'], 2)), /summary count/);
});
