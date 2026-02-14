import { describe, expect, it } from 'vitest';
import { buildWalletMetadata, parseWalletMetadata } from './walletMetadata';

describe('walletMetadata', () => {
  it('serializes and parses subtype metadata for insurance items', () => {
    const metadata = buildWalletMetadata('insuranceCard', 'health', {
      providerName: ' Blue Cross ',
      groupNumber: ' G-1234 ',
      policyNumber: '',
      ignoredField: 'should-not-persist'
    });

    expect(metadata).not.toBeNull();

    const parsed = parseWalletMetadata('insuranceCard', metadata);
    expect(parsed.itemSubtype).toBe('health');
    expect(parsed.subtypeFields).toEqual({
      providerName: 'Blue Cross',
      groupNumber: 'G-1234'
    });
  });

  it('returns empty metadata for invalid or unknown subtype payloads', () => {
    const metadata = buildWalletMetadata('passport', 'health', {
      providerName: 'test'
    });

    expect(metadata).toBeNull();

    const parsed = parseWalletMetadata('passport', '{"itemSubtype":"health"}');
    expect(parsed.itemSubtype).toBeNull();
    expect(parsed.subtypeFields).toEqual({});
  });

  it('handles malformed metadata safely', () => {
    const parsed = parseWalletMetadata('insuranceCard', 'not-json');
    expect(parsed.itemSubtype).toBeNull();
    expect(parsed.subtypeFields).toEqual({});
  });
});
