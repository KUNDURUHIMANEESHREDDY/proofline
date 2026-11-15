# ADR 0001: Use Forge KVS and Custom Entity Store for the MVP

- **Status:** Accepted for the first vertical slice
- **Date:** 2026-11-15

## Context

Proofline needs per-installation isolation, per-issue policy reads, append-only evidence writes, duplicate rejection, nonce replay protection, and encrypted storage for the GitHub Actions HMAC secret. The first issue-panel workflow does not require relational joins or complex filtering.

## Decision

Use Forge hosted storage through `@forge/kvs`, combining basic KVS records with a versioned Custom Entity Store summary:

- Evidence records use one key per issue and evidence ID digest.
- Nonce claims use `keyPolicy: FAIL_IF_EXISTS` and expire after ten minutes.
- Evidence records are stored in KVS; a bounded per-issue criterion summary is stored in a Custom Entity Store entity with a version field.
- A single Forge transaction writes the evidence record and conditionally increments the issue summary version. Concurrent writes that read the same version cannot both commit; losing writers reread and retry. This avoids a distributed lock and prevents lost updates.
- The issue panel reads the criterion summary with `kvs.entity().get` and the latest 25 evidence records with `kvs.get`; these point reads are strongly consistent. It does not derive verdicts from `kvs.query`, because KVS queries are eventually consistent.
- Policy writes use `OVERRIDE` because a policy is intentionally editable.
- The HMAC secret uses `kvs.setSecret` / `kvs.getSecret`.
- Forge installation/environment namespacing supplies tenant isolation.

## Consequences

- This is an appropriate MVP choice for key-based append, conditional summary updates, strongly-consistent point reads, and bounded summary reads; it is not a claim that KVS is the final long-term data model.
- The panel shows the latest 25 evidence records while the compact criterion summary retains the counts needed for deterministic verdicts. Full historical browsing can be added separately; it must not use eventually consistent query results to derive PASS.
- If issue-level evidence volume, reporting, or cross-record query needs exceed this model, revisit Forge SQL or Custom Entity Store with measured data and quota evidence.
- `FAIL_IF_EXISTS` gives application-level append-only behavior, not cryptographic immutability against app administrators or platform operators.
