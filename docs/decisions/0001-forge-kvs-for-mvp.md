# ADR 0001: Use Forge KVS for the MVP evidence store

- **Status:** Accepted for the first vertical slice
- **Date:** 2026-11-15

## Context

Proofline needs per-installation isolation, per-issue policy reads, append-only evidence writes, duplicate rejection, nonce replay protection, and encrypted storage for the GitHub Actions HMAC secret. The first issue-panel workflow does not require relational joins or complex filtering.

## Decision

Use `@forge/kvs` for the MVP:

- Evidence records use one key per issue and evidence ID digest.
- Nonce claims and per-issue write locks use `keyPolicy: FAIL_IF_EXISTS`; nonce claims expire after ten minutes and the issue lock has a 60-second lease.
- Evidence and the bounded per-issue criterion summary are committed together with `kvs.transact()`. The per-issue lock serializes read-modify-write updates because KVS transactions do not provide a compare-and-set condition for ordinary KVS keys.
- The issue panel reads the criterion summary and its latest 25 evidence records with `kvs.get`, which Forge documents as strongly consistent. It does not derive verdicts from `kvs.query`, because KVS queries are eventually consistent.
- Policy writes use `OVERRIDE` because a policy is intentionally editable.
- The HMAC secret uses `kvs.setSecret` / `kvs.getSecret`.
- Forge installation/environment namespacing supplies tenant isolation.

## Consequences

- This is an appropriate MVP choice for key-based append, strongly-consistent point reads, and bounded summary reads; it is not a claim that KVS is the final long-term data model.
- The panel shows the latest 25 evidence records while the compact criterion summary retains the counts needed for deterministic verdicts. Full historical browsing can be added separately; it must not use eventually consistent query results to derive PASS.
- If issue-level evidence volume, reporting, or cross-record query needs exceed this model, revisit Forge SQL or Custom Entity Store with measured data and quota evidence.
- `FAIL_IF_EXISTS` gives application-level append-only behavior, not cryptographic immutability against app administrators or platform operators.
