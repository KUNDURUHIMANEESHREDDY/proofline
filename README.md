# Proofline

**Evidence-backed verification for Jira engineering work.**

Proofline gives each Jira issue an evidence-backed completion status. It does not accept an agent's statement that work is done as proof. It derives a verdict from attributable, persisted evidence tied to explicit acceptance criteria.

## Current implementation

- Forge Jira issue panel (UI Kit).
- Per-issue required-criteria policy, versioned atomically with the evidence summary.
- Per-installation Forge hosted storage: Custom Entity Store for evidence and issue state, KVS for nonce claims, and Secret Store for signing keys.
- Authenticated GitHub Actions evidence web trigger using HMAC-SHA256, timestamp freshness, one-time nonce replay protection, per-issue version-checked atomic transactions, and duplicate evidence-ID protection with idempotent exact retransmissions.
- Encrypted Forge KVS Secret Store for the webhook signing key, with a 15-minute rotation overlap.
- Deterministic `PASS`, `FAIL`, and `INDETERMINATE` verdict derivation.
- MCP Inspector operational observation adapter; observations cannot satisfy verification criteria.
- Registered Forge app deployed to the `development` environment and installed in a Jira Cloud site for testing. Live evidence submission and Passport verification remain the final integration checks.

## Product principles

- Missing evidence never means success.
- Verdicts are deterministic: `PASS`, `FAIL`, or `INDETERMINATE`.
- CI is authoritative for build, test, and security outcomes.
- MCP operational telemetry is distinct from verification evidence.
- Evidence records preserve provenance and use per-issue version-checked atomic transactions with duplicate-ID checks; this is application-level append-only behavior, not cryptographic immutability.
- Model-generated claims never directly set a verdict.

## Repository layout

- `manifest.yml` — Forge Jira issue panel and GitHub Actions web trigger.
- `src/index.js` — Forge resolver and web trigger handlers.
- `src/frontend/index.jsx` — Jira Evidence Passport UI.
- `src/proofline/` — verdict, authentication, ingress, and storage modules.
- `schemas/proofline-evidence-v1.schema.json` — strict evidence envelope.
- `scripts/submit-proofline-evidence.mjs` — dependency-free GitHub Actions submitter.
- `.github/workflows/proofline-evidence.yml` — manually dispatched end-to-end CI evidence workflow.
- `docs/integrations/GITHUB_ACTIONS.md` — setup and workflow integration.
- `docs/integrations/EXISTING_REPOSITORIES.md` — reused foundation boundaries.
- `docs/decisions/0001-forge-kvs-for-mvp.md` — initial Forge storage decision and limits.

## Development

Requires Node.js 24 for the Forge runtime and CI workflow. Install dependencies with `npm ci`, then run:

```sh
npm test
forge lint
forge deploy --environment development
```

Register this existing repository once with `forge register proofline`; keep the generated `app.id` in `manifest.yml`.

See [GitHub Actions integration](docs/integrations/GITHUB_ACTIONS.md) for the Forge installation, web trigger, signing secret, and workflow setup.

## First vertical slice

A Jira issue starts with no configured criteria and therefore has an `INDETERMINATE` verdict. Configure `build`, `unit-tests`, and `security-scan`; then submit authenticated CI evidence. Missing evidence stays `INDETERMINATE`, any required failure produces `FAIL`, and only all-required passing evidence produces `PASS`.

## Security note

The HMAC authenticates possession of the shared per-installation secret. It is not a GitHub cryptographic workflow attestation. Anyone who can access that secret can submit allowed evidence for this Forge installation. Protect repository secrets and workflow write permissions, and never expose the secret to fork pull requests or untrusted code. Schema validation does not verify artifact contents or establish that a trusted CI job actually ran the claimed command.

**Site caution:** a Forge `development` environment can be installed into a production Jira site. Treat test issue creation and evidence writes as production data unless the site itself is a dedicated development/test site.
