import test from 'node:test';
import assert from 'node:assert/strict';
import { createForgeStore } from '../../src/proofline/forge-store.js';
import { StoreConflictError } from '../../src/proofline/errors.js';

function createMemoryKvs() {
  const entities = new Map();
  const values = new Map();
  const secrets = new Map();
  const entityMap = (name) => {
    if (!entities.has(name)) entities.set(name, new Map());
    return entities.get(name);
  };
  const clone = (value) => value === undefined ? undefined : structuredClone(value);

  return {
    entity(name) {
      const map = entityMap(name);
      return {
        get: async (key) => clone(map.get(key)),
        set: async (key, value, options = {}) => {
          if (options.keyPolicy === 'FAIL_IF_EXISTS' && map.has(key)) {
            throw Object.assign(new Error('key already exists'), { status: 409 });
          }
          map.set(key, clone(value));
        },
      };
    },
    get: async (key) => clone(values.get(key)),
    set: async (key, value, options = {}) => {
      if (options.keyPolicy === 'FAIL_IF_EXISTS' && values.has(key)) {
        throw Object.assign(new Error('key already exists'), { status: 409 });
      }
      values.set(key, clone(value));
    },
    getSecret: async (key) => clone(secrets.get(key)),
    setSecret: async (key, value) => secrets.set(key, clone(value)),
    transact() {
      const operations = [];
      return {
        set(key, value, options = {}) {
          operations.push({ key, value: clone(value), options });
          return this;
        },
        async execute() {
          await Promise.resolve();
          for (const operation of operations) {
            const { conditions } = operation.options;
            if (!conditions) continue;
            const current = entityMap(operation.options.entityName).get(operation.key);
            for (const condition of conditions.filters()) {
              if (condition.condition === 'EQUAL_TO' && current?.[condition.property] !== condition.values[0]) {
                throw Object.assign(new Error('transaction condition not met'), { status: 409 });
              }
            }
          }
          for (const operation of operations) {
            entityMap(operation.options.entityName).set(operation.key, clone(operation.value));
          }
        },
      };
    },
  };
}

const record = (evidenceId, criterionKey, outcome = 'PASS') => ({
  schemaVersion: 1,
  recordType: 'verification',
  evidenceId,
  issueKey: 'PAY-142',
  criterionKey,
  outcome,
  source: 'github-actions',
  sourceRunId: '123',
  observedAt: '2026-11-15T08:00:00Z',
  verifier: { name: 'proofline-test', version: '1.0.0' },
});

function makeStore() {
  return createForgeStore({ storage: createMemoryKvs() });
}

test('stores evidence and policy in one versioned issue state using the Forge filter interface', async () => {
  const store = makeStore();
  await store.saveIssuePolicy('PAY-142', { requiredCriteria: ['build'], updatedAt: '2026-11-15T08:00:00Z' });
  await store.saveEvidence(record('e1', 'build'));

  const result = await store.getIssueEvidence('PAY-142');
  assert.deepEqual(result.policy.requiredCriteria, ['build']);
  assert.equal(result.summary.evidenceCount, 1);
  assert.equal(result.records[0].evidenceId, 'e1');
  assert.equal(result.incomplete, false);
});

test('exact evidence retransmissions are idempotent; conflicting reuse is rejected', async () => {
  const store = makeStore();
  const item = record('same-id', 'build', 'PASS');
  await store.saveEvidence(item);
  await store.saveEvidence(item);
  await assert.rejects(store.saveEvidence(record('same-id', 'build', 'FAIL')), StoreConflictError);
  const result = await store.getIssueEvidence('PAY-142');
  assert.equal(result.summary.evidenceCount, 1);
  assert.equal(result.summary.byCriterion.build.passCount, 1);
  assert.equal(result.summary.byCriterion.build.failCount, 0);
});

test('concurrent evidence writes retry the version condition without losing either record', async () => {
  const store = makeStore();
  await Promise.all([
    store.saveEvidence(record('build-run', 'build', 'PASS')),
    store.saveEvidence(record('security-run', 'security', 'FAIL')),
  ]);
  const result = await store.getIssueEvidence('PAY-142');
  assert.equal(result.summary.evidenceCount, 2);
  assert.equal(result.summary.byCriterion.build.passCount, 1);
  assert.equal(result.summary.byCriterion.security.failCount, 1);
  assert.equal(result.records.length, 2);
});

test('concurrent policy and evidence updates preserve both state changes', async () => {
  const store = makeStore();
  await Promise.all([
    store.saveIssuePolicy('PAY-142', { requiredCriteria: ['build', 'security'], updatedAt: '2026-11-15T08:00:00Z' }),
    store.saveEvidence(record('build-run', 'build', 'PASS')),
  ]);
  const result = await store.getIssueEvidence('PAY-142');
  assert.deepEqual(result.policy.requiredCriteria, ['build', 'security']);
  assert.equal(result.summary.evidenceCount, 1);
  assert.equal(result.records.length, 1);
});

test('nonce claims reject replay', async () => {
  const store = makeStore();
  await store.claimNonce('nonce-1', Date.parse('2026-11-15T08:00:00Z'));
  await assert.rejects(store.claimNonce('nonce-1', Date.parse('2026-11-15T08:00:01Z')), StoreConflictError);
});
