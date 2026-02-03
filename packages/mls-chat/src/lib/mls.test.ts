import { describe, expect, it } from 'vitest';
import { MLS_CIPHERSUITE_ID, MLS_CIPHERSUITE_NAME, MlsClient } from './mls.js';

describe('MlsClient', () => {
  it('exports the standard ciphersuite ID', () => {
    expect(MLS_CIPHERSUITE_ID).toBe(0x0003);
  });

  it('exports the ciphersuite name', () => {
    expect(MLS_CIPHERSUITE_NAME).toBe(
      'MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519'
    );
  });

  it('can be instantiated with a user ID', () => {
    const client = new MlsClient('user-123');
    expect(client).toBeInstanceOf(MlsClient);
    client.close();
  });
});
