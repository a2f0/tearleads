import { describe, expect, it } from 'vitest';
import {
  formatDunsNumber,
  formatEin,
  isDunsNumber,
  isEin,
  normalizeBusinessIdentifiers,
  normalizeDunsNumber,
  normalizeEin,
  validateDunsNumber,
  validateEin
} from './businessIdentifiers.js';

describe('validateDunsNumber', () => {
  it('returns normalized digits for a valid DUNS number', () => {
    expect(validateDunsNumber('12-345-6789')).toEqual({
      ok: true,
      value: '123456789'
    });
  });

  it('rejects unsupported characters', () => {
    expect(validateDunsNumber('12A456789')).toEqual({
      ok: false,
      error: 'DUNS number can only contain digits, spaces, and hyphens'
    });
  });

  it('rejects invalid length', () => {
    expect(validateDunsNumber('1234')).toEqual({
      ok: false,
      error: 'DUNS number must contain exactly 9 digits'
    });
  });

  it('rejects all-zero values', () => {
    expect(validateDunsNumber('000-000-000')).toEqual({
      ok: false,
      error: 'DUNS number cannot be all zeros'
    });
  });

  it('rejects blank input', () => {
    expect(validateDunsNumber('   ')).toEqual({
      ok: false,
      error: 'DUNS number is required'
    });
  });
});

describe('DUNS helpers', () => {
  it('normalizes valid inputs and returns null for invalid values', () => {
    expect(normalizeDunsNumber('12 345 6789')).toBe('123456789');
    expect(normalizeDunsNumber('bad-value')).toBeNull();
  });

  it('formats normalized DUNS output', () => {
    expect(formatDunsNumber('123456789')).toBe('12-345-6789');
    expect(formatDunsNumber('bad-value')).toBeNull();
  });

  it('exposes a boolean validator', () => {
    expect(isDunsNumber('123456789')).toBe(true);
    expect(isDunsNumber('12345678')).toBe(false);
  });
});

describe('validateEin', () => {
  it('returns normalized digits for a valid EIN', () => {
    expect(validateEin('12-3456789')).toEqual({
      ok: true,
      value: '123456789'
    });
  });

  it('rejects unsupported characters', () => {
    expect(validateEin('12A456789')).toEqual({
      ok: false,
      error: 'EIN can only contain digits, spaces, and hyphens'
    });
  });

  it('rejects invalid length', () => {
    expect(validateEin('12345678')).toEqual({
      ok: false,
      error: 'EIN must contain exactly 9 digits'
    });
  });

  it('rejects an invalid prefix', () => {
    expect(validateEin('00-1234567')).toEqual({
      ok: false,
      error: 'EIN prefix cannot be 00'
    });
  });

  it('rejects an all-zero suffix', () => {
    expect(validateEin('12-0000000')).toEqual({
      ok: false,
      error: 'EIN suffix cannot be all zeros'
    });
  });

  it('rejects blank input', () => {
    expect(validateEin(' ')).toEqual({
      ok: false,
      error: 'EIN is required'
    });
  });
});

describe('EIN helpers', () => {
  it('normalizes valid inputs and returns null for invalid values', () => {
    expect(normalizeEin('12 3456789')).toBe('123456789');
    expect(normalizeEin('12AB56789')).toBeNull();
  });

  it('formats normalized EIN output', () => {
    expect(formatEin('123456789')).toBe('12-3456789');
    expect(formatEin('123')).toBeNull();
  });

  it('exposes a boolean validator', () => {
    expect(isEin('123456789')).toBe(true);
    expect(isEin('00-0000000')).toBe(false);
  });
});

describe('normalizeBusinessIdentifiers', () => {
  it('normalizes both identifiers when valid', () => {
    expect(
      normalizeBusinessIdentifiers({
        dunsNumber: '12-345-6789',
        ein: '12-3456789'
      })
    ).toEqual({
      ok: true,
      value: {
        dunsNumber: '123456789',
        ein: '123456789'
      }
    });
  });

  it('returns empty normalized identifiers for empty optional fields', () => {
    expect(
      normalizeBusinessIdentifiers({
        dunsNumber: ' ',
        ein: null
      })
    ).toEqual({ ok: true, value: {} });
  });

  it('returns field-specific errors for invalid values', () => {
    expect(
      normalizeBusinessIdentifiers({
        dunsNumber: '000-000-000',
        ein: '00-0000000'
      })
    ).toEqual({
      ok: false,
      errors: [
        { field: 'dunsNumber', error: 'DUNS number cannot be all zeros' },
        { field: 'ein', error: 'EIN prefix cannot be 00' }
      ]
    });
  });
});
