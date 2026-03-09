import { describe, expect, it } from 'vitest';
import {
  findWalletCountryOptions,
  getWalletCountryOptionByCode,
  listWalletCountryOptions,
  normalizeWalletCountryCode
} from './walletCountryLookup';

describe('walletCountryLookup', () => {
  it('provides canonical country options including US', () => {
    const options = listWalletCountryOptions();
    expect(options.length).toBeGreaterThan(0);

    const unitedStates = getWalletCountryOptionByCode('US');
    expect(unitedStates).not.toBeNull();
  });

  it('normalizes country input by code, name, and label', () => {
    const unitedStates = getWalletCountryOptionByCode('US');
    if (!unitedStates) {
      throw new Error('US country option is required for this test');
    }

    expect(normalizeWalletCountryCode('us')).toBe('US');
    expect(normalizeWalletCountryCode(unitedStates.name)).toBe('US');
    expect(normalizeWalletCountryCode(unitedStates.label)).toBe('US');
    expect(normalizeWalletCountryCode('not-a-country')).toBeNull();
  });

  it('supports query search across country names and codes', () => {
    const results = findWalletCountryOptions('us');
    expect(results.length).toBeGreaterThan(0);
  });
});
