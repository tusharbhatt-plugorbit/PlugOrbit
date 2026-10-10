/* eslint-disable no-bitwise -- a hash is bit arithmetic */
/**
 * Cheap, stable fingerprint of a JSON value (length + FNV-1a hash). Sync uses it to
 * tell "changed since the last sync" without keeping a second copy of the data.
 * Not a security measure.
 */
export function sigOf(value: unknown): string {
  const json = JSON.stringify(value) ?? 'undefined';
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${json.length}:${(hash >>> 0).toString(16)}`;
}
