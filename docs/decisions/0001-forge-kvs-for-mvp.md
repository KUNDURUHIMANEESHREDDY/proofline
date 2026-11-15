# ADR 0001: Use Forge KVS for the MVP evidence store

- **Status:** Accepted for the first vertical slice
- **Date:** 2026-11-15

## Context

Proofline needs per-installation isolation, per-issue policy reads, append-only evidence writes, duplicate rejection, nonce replay protection, and encrypted storage for the GitHub Actions HMAC secret. The first issue-panel workflow does not require relational joins or complex filtering.

## Decision

Use `@forge/kvs` for the MVP:

- Evidence records use one key per issue and evidence ID digest.
- Evidence and nonce writes use `keyPolicy: FAIL_IF_EXISTS`.
- Policy writes use `OVERRIDE` because a policy is intentionally editable.
- The HMAC secret uses `kvs.setSecret` / `kvs.getSecret`.
- Forge installation/environment namespacing supplies tenant isolation.
- Evidence queries use an issue-key prefix and cursor pagination. The first panel read is capped at 1,980 records and fails closed to `INDETERMINATE` if more history exists.

## Consequences

- This is an appropriate MVP choice for key-based append and prefix-query patterns; it is not a claim that KVS is the final long-term data model.
- Query pagination and read volume must be monitored. The panel must never report PASS from a truncated history.
- If issue-level evidence volume, reporting, or cross-record query needs exceed this model, revisit Forge SQL or Custom Entity Store with measured data and quota evidence.
- `FAIL_IF_EXISTS` gives application-level append-only behavior, not cryptographic immutability against app administrators or platform operators.
