# Proofline

**Evidence-backed verification for Jira engineering work.**

Proofline gives each Jira issue an evidence-backed completion status. It does not accept an agent's statement that work is done as proof. It derives a verdict from attributable, persisted evidence tied to explicit acceptance criteria.

## Current implementation

- Forge Jira issue panel (UI Kit).
- Per-issue required-criteria policy.
- Per-installation Forge KVS storage for evidence and policies.
- Authenticated GitHub Actions evidence web trigger using HMAC-SHA256, timestamp freshness, one-time nonce replay protection, and duplicate evidence rejection.
- Encrypted Forge KVS Secret Store for the webhook signing key, with a 15-minute rotation overlap.
- Deterministic `PASS`, `FAIL`, and `INDETERMINATE` verdict derivation.
- MCP Inspector operational observation adapter; observations cannot satisfy verification criteria.

The Forge app is scaffolded but has not yet been registered, deployed, or installed in a Jira site. The first successful Forge deployment and live end-to-end webhook test remain outstanding.

## Product principles

- Missing evidence never means success.
- Verdicts are deterministic: `PASS`, `FAIL`, or `INDETERMINATE`.
- CI is authoritative for build, test, and security outcomes.
- MCP operational telemetry is distinct from verification evidence.
- Evidence records preserve provenance and use fail-if-exists writes; this is application-level append-only behavior, not cryptographic immutability.
- Model-generated claims never directly set a verdict.

## Repository layout

- `manifest.yml` — Forge Jira issue panel and GitHub Actions web trigger.
- `src/index.js` — Forge resolver and web trigger handlers.
- `src/frontend/index.jsx` — Jira Evidence Passport UI.
- `src/proofline/` — verdict, authentication, ingress, and storage modules.
- `schemas/proofline-evidence-v1.schema.json` — strict evidence envelope.
- `scripts/submit-proofline-evidence.mjs` — dependency-free GitHub Actions submitter.
- `docs/proofline/PRODUCT_SPEC.md` — product scope, architecture, security requirements, and delivery plan.
- `docs/integrations/GITHUB_ACTIONS.md` — setup and workflow integration.
- `docs/integrations/EXISTING_REPOSITORIES.md` — reused foundation boundaries.
- `docs/decisions/0001-forge-kvs-for-mvp.md` — initial Forge storage decision and limits.

## Development

Requires Node.js 20 or later. Install dependencies with `npm install`, then run:

```sh
npm test
```

Install the Forge CLI globally and register the app once:

```sh
npm install --global @forge/cli
forge register proofline
forge lint
forge deploy --environment development
```

See [GitHub Actions integration](docs/integrations/GITHUB_ACTIONS.md) for the Forge installation, web trigger, signing secret, and workflow setup.

## First vertical slice

A Jira issue starts with no configured criteria and therefore has an `INDETERMINATE` verdict. Configure `build`, `unit-tests`, and `security-scan`; then submit authenticated CI evidence. Missing evidence stays `INDETERMINATE`, any required failure produces `FAIL`, and only all-required passing evidence produces `PASS`.

## Security note

The HMAC authenticates possession of the shared per-installation secret. It is not a GitHub cryptographic workflow attestation. Anyone who can access that secret can submit allowed evidence for that Forge installation. Protect repository secrets and workflow write permissions, and never expose the secret to fork pull requests or untrusted code. Schema validation does not verify artifact contents or establish that a trusted CI job actually ran the claimed command.
