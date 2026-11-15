# Existing repository reuse

Proofline reuses the following bounded concepts and contracts from existing repositories:

- **No Presumed Pass:** the three-valued verdict contract is implemented natively in `src/proofline/verdict.js` for the Forge-compatible JavaScript runtime. It preserves empty-policy `INDETERMINATE`, missing-evidence `INDETERMINATE`, failure precedence, duplicate-ID rejection, and unmatched-criterion reporting. The original loopback-only Python HTTP service and SQLite store are not embedded in Forge.
- **MCP Inspector:** `src/proofline/adapters/mcp-inspector.js` maps only an explicit allowlist of already-redacted operational events into `observation` records. It never emits a criterion or PASS/FAIL outcome. It does not copy MCP Inspector's proxy, dashboard, transport, or telemetry dependencies.
- **Watch-dogs:** its local verification flow distinguishes passing checks from unverified or inconclusive states, but its evidence is tied to a local staged project and configured command. It is not imported as a trusted CI attestor. A future adapter can submit its result as a separately identified source after a trust policy is designed.
- **MLAC:** its Ed25519 worker attestations bind a report digest and input artifact digests to a worker identity and image, with nonce replay protection. Those attestations are specific to MLAC's isolated candidate-evaluation worker. The implementation is not copied into the MVP; Proofline first needs a CI-specific attestation contract and key lifecycle.
- **DataOS:** its README explicitly notes that provenance event recording is called only from tests and that lineage traversal currently follows graph edges rather than an audit trail. No DataOS provenance code is imported as an evidence ledger.

These boundaries are intentional: source telemetry, local execution observations, CI verification, and cryptographic attestations are different trust classes. None may be silently promoted into another class.
