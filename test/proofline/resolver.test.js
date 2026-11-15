import test from 'node:test';
import assert from 'node:assert/strict';
import { makeResolver } from '@forge/resolver';

test('makeResolver creates a callable handler for named resolver definitions', async () => {
  const handler = makeResolver({
    ping: async ({ payload, context }) => ({
      received: payload.message,
      issueKey: context.extension.issue.key,
    }),
  });

  assert.equal(typeof handler, 'function');
  const result = await handler({
    call: { functionKey: 'ping', payload: { message: 'ok' } },
    context: { extension: { issue: { key: 'PROOF-1' } } },
  });
  assert.deepEqual(result, { received: 'ok', issueKey: 'PROOF-1' });
});

test('makeResolver rejects unknown resolver function keys', async () => {
  const handler = makeResolver({ ping: async () => 'ok' });
  await assert.rejects(
    handler({ call: { functionKey: 'missing' }, context: {} }),
    /no definition for 'missing'/,
  );
});
