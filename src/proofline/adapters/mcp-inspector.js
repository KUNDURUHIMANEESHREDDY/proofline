import { createHash } from 'node:crypto';

const EVENT_NAMES = new Map([
  ['rpc.request', 'mcp.rpc.request'],
  ['rpc.response', 'mcp.rpc.response'],
  ['rpc.timeout', 'mcp.timeout'],
  ['proxy.timeout', 'mcp.timeout'],
  ['contract.diff', 'mcp.contract.diff'],
]);

function safeProtocol(transport) {
  if (transport === 'stdio') return 'stdio';
  if (transport === 'http' || transport === 'streamable-http') return 'streamable-http';
  return 'unknown';
}

function safeHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

function safeIdentifier(value) {
  const normalized = value.replace(/[^A-Za-z0-9:._/-]/g, '_').slice(0, 120);
  return /^[A-Za-z0-9]/.test(normalized) ? normalized : `s-${normalized}`;
}

/**
 * Convert one already-redacted MCP Inspector dashboard event into an
 * operational observation. This adapter intentionally never emits a
 * verification record or criterion outcome: MCP activity is not CI proof.
 */
export function toProoflineObservation(event, {
  issueKey,
  sessionId,
  verifierVersion = '0.1.0',
} = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('event must be an object');
  }
  if (typeof issueKey !== 'string' || !/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(issueKey)) {
    throw new TypeError('issueKey must be a Jira issue key');
  }
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new TypeError('sessionId must be a non-empty string');
  }
  if (typeof verifierVersion !== 'string' || !verifierVersion.trim() || verifierVersion.length > 80) {
    throw new TypeError('verifierVersion must be a non-empty string of at most 80 characters');
  }
  const eventName = EVENT_NAMES.get(event.event);
  if (!eventName) return null;

  const sessionToken = safeIdentifier(sessionId);
  const eventId = Number.isSafeInteger(event.id) && event.id > 0
    ? String(event.id)
    : createHash('sha256').update(JSON.stringify({
      event: event.event,
      time: event.time,
      method: event.method,
      request_id: event.request_id,
    })).digest('hex').slice(0, 24);

  let observationStatus = 'observed';
  if (eventName === 'mcp.timeout') observationStatus = 'timeout';
  else if (eventName === 'mcp.rpc.response') observationStatus = event.is_error === true ? 'error' : 'success';

  const record = {
    schemaVersion: 1,
    recordType: 'observation',
    evidenceId: `mcp-inspector:${sessionToken}:${eventId}`,
    issueKey,
    source: 'mcp-inspector',
    sourceRunId: sessionToken,
    observedAt: typeof event.time === 'string' ? event.time : new Date().toISOString(),
    verifier: { name: 'proofline-mcp-inspector-adapter', version: verifierVersion },
    eventName,
    observationStatus,
    protocol: safeProtocol(event.transport),
  };

  if (typeof event.tool === 'string' && event.tool.trim()) record.toolName = event.tool.slice(0, 128);
  if (typeof event.duration_ms === 'number' && Number.isFinite(event.duration_ms) && event.duration_ms >= 0) {
    record.durationMs = Math.min(event.duration_ms, 86_400_000);
  }
  const contractHash = safeHash(event.current_hash ?? event.hash);
  if (contractHash) record.contractHash = contractHash;
  return record;
}
