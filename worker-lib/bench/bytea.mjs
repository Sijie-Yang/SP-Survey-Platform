import { base64ToBytes } from '../crypto/byokAesGcm.mjs';

export function toByteaHex(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return `\\x${Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** PostgREST may return BYTEA as \\xhex or base64. */
export function fromBytea(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      const hex = value.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    return base64ToBytes(value);
  }
  return new Uint8Array(value);
}
