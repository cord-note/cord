import { describe, it, expect } from 'bun:test';
import { encodeRecoveryKey, generateRecoveryKey, normaliseRecoveryKey } from '../recoveryKey';

// A recovery key is 160 random bits someone may copy onto paper and type back
// months later, so the format is forgiving: Crockford base32, grouped in fours.

const FORMAT = /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/;

describe('recovery keys', () => {
  it('generates eight groups of four Crockford characters', () => {
    expect(generateRecoveryKey()).toMatch(FORMAT);
  });

  it('never repeats', () => {
    expect(generateRecoveryKey()).not.toBe(generateRecoveryKey());
  });

  it('encodes bytes big-endian, five bits per character', () => {
    expect(encodeRecoveryKey(new Uint8Array(20))).toBe(Array(8).fill('0000').join('-'));
    expect(encodeRecoveryKey(new Uint8Array(20).fill(255))).toBe(Array(8).fill('ZZZZ').join('-'));
    // 00001 00001 00010 0… → 1 1 2 0
    expect(encodeRecoveryKey(new Uint8Array([0b00001000, 0b01000100, 0, 0, 0])).slice(0, 4)).toBe('1120');
  });

  it('normalises case, separators and look-alike letters', () => {
    expect(normaliseRecoveryKey(' k7qm-2xvd o1il ')).toBe('K7QM2XVD0111');
  });
});
