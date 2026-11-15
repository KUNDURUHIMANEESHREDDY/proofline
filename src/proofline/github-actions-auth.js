import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function safeEqualHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signProoflineRequest({ secret, timestamp, nonce, body }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new TypeError('secret must be at least 32 characters');
  if (!/^\d{10}$/.test(String(timestamp))) throw new TypeError('timestamp must be Unix seconds');
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new TypeError('nonce is invalid');
  if (typeof body !== 'string') throw new TypeError('body must be the exact serialized request body');
  return createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`, 'utf8').digest('hex');
}

export function verifyProoflineRequest({ secretState, timestamp, nonce, signature, body, nowMs = Date.now() }) {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return { valid: false, reason: 'body_too_large_or_invalid' };
  }
  if (!/^\d{10}$/.test(String(timestamp)) || !/^[A-Za-z0-9_-]{16,128}$/.test(String(nonce))) {
    return { valid: false, reason: 'invalid_auth_headers' };
  }
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs) || Math.abs(nowMs - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return { valid: false, reason: 'stale_timestamp' };
  }
  const supplied = typeof signature === 'string' && signature.startsWith('sha256=')
    ? signature.slice('sha256='.length)
    : '';
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return { valid: false, reason: 'invalid_signature' };

  const candidates = [];
  if (typeof secretState?.current === 'string') candidates.push(secretState.current);
  if (typeof secretState?.previous?.secret === 'string' &&
      Number.isFinite(secretState.previous.validUntil) && secretState.previous.validUntil >= nowMs) {
    candidates.push(secretState.previous.secret);
  }
  const valid = candidates.some((secret) => {
    if (secret.length < 32) return false;
    const expected = signProoflineRequest({ secret, timestamp, nonce, body });
    return safeEqualHex(expected, supplied);
  });
  return valid ? { valid: true } : { valid: false, reason: 'invalid_signature' };
}
