# ADR 0001: Use Forge KVS and Custom Entity Store for the MVP

- **Status:** Accepted for the first vertical slice
- **Date:** 2026-11-15

## Context

Proofline needs per-installation isolation, per-issue policy reads, append-only evidence writes, duplicate rejection, nonce replay protection, and encrypted storage for the GitHub Actions HMAC secret. The first issue-panel workflow does not require relational joins or complex filtering.

## Decision

Use Forge hosted storage through `@forge/kvs`, combining basic KVS for nonce claims with versioned Custom Entity Store entities for issue state and evidence:

- Nonce claims use basic KVS with `keyPolicy: FAIL_IF_EXISTS` and expire after ten minutes.
- Evidence records and the per-issue state (criterion summary plus policy) are stored in two Custom Entity Store entities. Evidence keys include the Jira issue key and a SHA-256 digest of the evidence ID.
- A single Custom Entity Store transaction writes each evidence record and conditionally increments the issue-state version. Policy updates use the same version condition. Concurrent evidence or policy writes that read the same version cannot both commit; losing writers reread and retry. This avoids a distributed lock and prevents lost updates.
- The issue panel reads policy and criterion summary from one issue-state entity snapshot, so a policy change cannot be mixed with a summary read from another version.
- The issue panel reads the issue state and latest 25 evidence records with `kvs.entity().get`; these point reads are strictly consistent. It does not derive verdicts from entity queries, because Custom Entity Store queries are eventually consistent.
- The HMAC secret uses `kvs.setSecret` / `kvs.getSecret`.
- Forge installation/environment namespacing supplies tenant isolation.

## Consequences

- This is an appropriate MVP choice for key-based append, conditional summary updates, strongly-consistent point reads, and bounded summary reads; it is not a claim that KVS is the final long-term data model.
- The panel shows the latest 25 evidence records while the compact criterion summary retains the counts needed for deterministic verdicts. Full historical browsing can be added separately; it must not use eventually consistent query results to derive PASS.
- If issue-level evidence volume, reporting, or cross-record query needs exceed this model, revisit Forge SQL or Custom Entity Store with measured data and quota evidence.
- Version-checked transactions and the absence of app delete operations provide application-level append-only behavior, not cryptographic immutability against app administrators or platform operators.
