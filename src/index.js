import Resolver from '@forge/resolver';
import api, { authorize, route } from '@forge/api';
import { randomBytes } from 'node:crypto';
import { deriveVerdictFromSummary } from './proofline/verdict.js';
import { handleGitHubActionsIngress } from './proofline/github-actions-ingress.js';
import {
  claimNonce, getIssueEvidence, getIssuePolicy, getSecretState,
  saveEvidence, saveIssuePolicy, saveSecretState,
} from './proofline/forge-store.js';

const CRITERION_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const ROTATION_GRACE_MS = 15 * 60 * 1000;

function issueContext(context) {
  const issueKey = context?.extension?.issue?.key ?? context?.platformContext?.issueKey;
  const issueId = context?.extension?.issue?.id ?? context?.platformContext?.issueId;
  if (typeof issueKey !== 'string' || typeof issueId !== 'string') throw new Error('Jira issue context is unavailable');
  return { issueKey, issueId };
}

async function requireIssueEdit(issueId) {
  const allowed = await authorize().onJiraIssue(issueId).canEdit();
  if (!allowed) throw new Error('You need permission to edit this Jira issue');
}

async function requireJiraAdministrator() {
  const response = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  if (!response.ok) throw new Error('Unable to verify Jira administrator permission');
  const payload = await response.json();
  if (payload?.permissions?.ADMINISTER?.havePermission !== true) {
    throw new Error('Only a Jira administrator with the ADMINISTER global permission can manage the GitHub Actions signing secret');
  }
}

const resolver = new Resolver();

resolver.define('getPassport', async ({ context }) => {
  const { issueKey } = issueContext(context);
  const [policy, evidenceResult] = await Promise.all([
    getIssuePolicy(issueKey),
    getIssueEvidence(issueKey),
  ]);
  const evidence = evidenceResult.records.filter((record) => record.recordType === 'verification');
  const summary = evidenceResult.summary;
  const verdict = deriveVerdictFromSummary(policy.requiredCriteria ?? [], summary);
  return {
    issueKey,
    requiredCriteria: policy.requiredCriteria ?? [],
    verdict,
    evidence: evidence.sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, 25),
    evidenceCount: summary.evidenceCount ?? 0,
  };
});

resolver.define('saveCriteria', async ({ payload, context }) => {
  const { issueKey, issueId } = issueContext(context);
  await requireIssueEdit(issueId);
  const criteria = payload?.criteria;
  if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > 20 ||
      criteria.some((criterion) => typeof criterion !== 'string' || !CRITERION_PATTERN.test(criterion)) ||
      new Set(criteria).size !== criteria.length) {
    throw new Error('Criteria must contain 1–20 unique lowercase keys (letters, numbers, dot, underscore, hyphen)');
  }
  await saveIssuePolicy(issueKey, { requiredCriteria: criteria, updatedAt: new Date().toISOString() });
  return { saved: true };
});

resolver.define('getWebhookStatus', async () => {
  await requireJiraAdministrator();
  const state = await getSecretState();
  return { configured: Boolean(state?.current), previousValidUntil: state?.previous?.validUntil ?? null };
});

resolver.define('rotateWebhookSecret', async () => {
  await requireJiraAdministrator();
  const now = Date.now();
  const oldState = await getSecretState();
  const secret = randomBytes(32).toString('base64url');
  await saveSecretState({
    current: secret,
    previous: oldState?.current ? { secret: oldState.current, validUntil: now + ROTATION_GRACE_MS } : null,
    createdAt: new Date(now).toISOString(),
  });
  return { secret, previousValidUntil: oldState?.current ? now + ROTATION_GRACE_MS : null };
});

export const handler = resolver.getDefinitions();

export async function ingest(payload) {
  return handleGitHubActionsIngress(payload, {
    getSecretState,
    claimNonce,
    saveEvidence,
  });
}
