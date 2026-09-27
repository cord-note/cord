import { randomBytes } from 'node:crypto';

/**
 * Recovery keys: 20 random bytes (160 bits) in Crockford base32, shown as
 * eight groups of four — `K7QM-2XVD-…`. Crockford leaves out I, L, O and U, so
 * a key copied by hand survives the usual misreadings (see normalise below).
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_KEY_BYTES = 20;

export function encodeRecoveryKey(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff; // never more than 12 live bits
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return (out.match(/.{1,4}/g) ?? []).join('-');
}

export function generateRecoveryKey(): string {
  return encodeRecoveryKey(randomBytes(RECOVERY_KEY_BYTES));
}

/** The form that is hashed and compared: uppercase, no separators, look-alikes folded. */
export function normaliseRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}
