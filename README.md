# Proofline

**Evidence-backed verification for Jira engineering work.**

Proofline gives each Jira issue an evidence-backed completion status. It does not accept an agent's statement that work is done as proof. It derives a verdict from attributable, persisted evidence tied to explicit acceptance criteria.

## Current status

The repository is initialized with the product/architecture spec and the v1 evidence contract. The Forge app, authenticated ingestion path, storage layer, and verdict engine are not implemented yet.

## Product principles

- Missing evidence never means success.
- Verdicts are deterministic: `PASS`, `FAIL`, or `INDETERMINATE`.
- CI is authoritative for build, test, and security outcomes.
- MCP operational telemetry is distinct from verification evidence.
- Evidence records preserve provenance and are not silently overwritten.
- Model-generated claims never directly set a verdict.

## Repository layout

- `docs/proofline/PRODUCT_SPEC.md` — product scope, architecture, security requirements, and delivery plan.
- `schemas/proofline-evidence-v1.schema.json` — strict evidence envelope.
- `src/proofline/evidence-schema.js` — JSON Schema validator.
- `test/proofline-evidence-schema.test.js` — contract tests.

## Development

Requires Node.js 20 or later.

```sh
npm install
npm test
```

## Planned first vertical slice

A Jira issue has three required criteria: `build`, `unit-tests`, and `security-scan`. Proofline ingests attributable CI results, stores evidence, and renders the derived verdict in a Jira issue panel. A missing security result must produce `INDETERMINATE`, never `PASS`.

## Security note

Schema validation checks payload shape only. It does not authenticate an evidence source, verify artifact contents, or authorize a record to affect a verdict. Those checks belong in the server-side ingestion and policy layers.
