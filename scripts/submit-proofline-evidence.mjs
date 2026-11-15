import { createHmac, randomUUID } from 'node:crypto';

const required = [
  'PROOFLINE_WEBTRIGGER_URL', 'PROOFLINE_WEBHOOK_SECRET', 'PROOFLINE_ISSUE_KEY',
  'PROOFLINE_CRITERION_KEY', 'PROOFLINE_OUTCOME', 'GITHUB_RUN_ID',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}
if (!['PASS', 'FAIL'].includes(process.env.PROOFLINE_OUTCOME)) throw new Error('PROOFLINE_OUTCOME must be PASS or FAIL');
if (process.env.PROOFLINE_WEBHOOK_SECRET.length < 32) throw new Error('PROOFLINE_WEBHOOK_SECRET must be at least 32 characters');
if (!/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(process.env.PROOFLINE_ISSUE_KEY)) throw new Error('PROOFLINE_ISSUE_KEY is invalid');
if (!/^[a-z][a-z0-9._-]{0,63}$/.test(process.env.PROOFLINE_CRITERION_KEY)) throw new Error('PROOFLINE_CRITERION_KEY is invalid');
const endpoint = new URL(process.env.PROOFLINE_WEBTRIGGER_URL);
if (endpoint.protocol !== 'https:') throw new Error('PROOFLINE_WEBTRIGGER_URL must use HTTPS');

const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = randomUUID();
const jobKey = (process.env.GITHUB_JOB || process.env.PROOFLINE_CRITERION_KEY).slice(0, 80);
const record = {
  schemaVersion: 1,
  recordType: 'verification',
  evidenceId: `github-actions:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT || '1'}:${jobKey}:${process.env.PROOFLINE_CRITERION_KEY}`,
  issueKey: process.env.PROOFLINE_ISSUE_KEY,
  criterionKey: process.env.PROOFLINE_CRITERION_KEY,
  outcome: process.env.PROOFLINE_OUTCOME,
  source: 'github-actions',
  sourceRunId: process.env.GITHUB_RUN_ID,
  observedAt: new Date().toISOString(),
  verifier: { name: 'proofline-github-actions-workflow', version: '1.0.0' },
  ...(process.env.PROOFLINE_SUMMARY ? { summary: process.env.PROOFLINE_SUMMARY.slice(0, 500) } : {}),
};
if (Boolean(process.env.PROOFLINE_ARTIFACT_URI) !== Boolean(process.env.PROOFLINE_ARTIFACT_SHA256)) {
  throw new Error('PROOFLINE_ARTIFACT_URI and PROOFLINE_ARTIFACT_SHA256 must be provided together');
}
if (process.env.PROOFLINE_ARTIFACT_URI && process.env.PROOFLINE_ARTIFACT_SHA256) {
  if (!/^[a-f0-9]{64}$/i.test(process.env.PROOFLINE_ARTIFACT_SHA256)) throw new Error('PROOFLINE_ARTIFACT_SHA256 must be a SHA-256 hex digest');
  if (!process.env.PROOFLINE_ARTIFACT_URI.startsWith('https://')) throw new Error('PROOFLINE_ARTIFACT_URI must use HTTPS');
  record.artifact = {
    uri: process.env.PROOFLINE_ARTIFACT_URI,
    sha256: process.env.PROOFLINE_ARTIFACT_SHA256.toLowerCase(),
  };
}
const body = JSON.stringify(record);
const signature = createHmac('sha256', process.env.PROOFLINE_WEBHOOK_SECRET)
  .update(`${timestamp}.${nonce}.${body}`, 'utf8')
  .digest('hex');
const response = await fetch(process.env.PROOFLINE_WEBTRIGGER_URL, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-proofline-timestamp': timestamp,
    'x-proofline-nonce': nonce,
    'x-proofline-signature': `sha256=${signature}`,
  },
  body,
});
const responseText = await response.text();
if (!response.ok) throw new Error(`Proofline rejected evidence (${response.status}): ${responseText}`);
process.stdout.write(`${responseText}\n`);
