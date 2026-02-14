import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createRequestNonce,
  createTeeSecureEnvelope,
  isJsonValue,
  isTeeEchoRequest,
  isTeeEchoResponse,
  type JsonValue,
  parseTeeEchoRequest,
  parseTeeEchoResponse,
  parseTeeSecureEnvelope,
  selectActiveSigningKey,
  stableStringify,
  type TeeSigningKeyConfig,
  verifyTeeSecureEnvelope
} from './index.js';

function generateSigningKeys(): {
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const keyPair = generateKeyPairSync('ed25519');

  const privateKeyPem = keyPair.privateKey.export({
    type: 'pkcs8',
    format: 'pem'
  });

  const publicKeyPem = keyPair.publicKey.export({
    type: 'spki',
    format: 'pem'
  });

  if (typeof privateKeyPem !== 'string' || typeof publicKeyPem !== 'string') {
    throw new Error('Unable to export signing key pair as PEM strings');
  }

  return {
    privateKeyPem,
    publicKeyPem
  };
}

describe('createTeeSecureEnvelope', () => {
  it('creates proofs that verify with a trusted key', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();
    const nonce = 'nonce-123';
    const requestBody: JsonValue = { message: 'hello' };
    const now = new Date('2026-01-02T03:04:05.000Z');

    const envelope = createTeeSecureEnvelope({
      data: {
        message: 'hello',
        receivedAt: '2026-01-02T03:04:05.000Z'
      },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: nonce,
      requestBody,
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: nonce,
      requestBody,
      responseStatus: 200,
      trustedPublicKeys: {
        primary: publicKeyPem
      },
      expectedTransport: 'tls',
      now
    });

    expect(verification.isValid).toBe(true);
    expect(verification.failureCodes).toEqual([]);
  });

  it('throws for empty request nonce', () => {
    const { privateKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    expect(() =>
      createTeeSecureEnvelope({
        data: { message: 'hello' },
        method: 'POST',
        path: '/v1/tee/echo',
        requestNonce: '',
        requestBody: { message: 'hello' },
        responseStatus: 200,
        keyId: 'primary',
        privateKeyPem,
        transport: 'tls',
        now
      })
    ).toThrow('requestNonce must be non-empty');
  });

  it('throws for invalid ttl', () => {
    const { privateKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    expect(() =>
      createTeeSecureEnvelope({
        data: { message: 'hello' },
        method: 'POST',
        path: '/v1/tee/echo',
        requestNonce: 'nonce-123',
        requestBody: { message: 'hello' },
        responseStatus: 200,
        keyId: 'primary',
        privateKeyPem,
        transport: 'tls',
        now,
        ttlSeconds: 0
      })
    ).toThrow('ttlSeconds must be a positive number');

    expect(() =>
      createTeeSecureEnvelope({
        data: { message: 'hello' },
        method: 'POST',
        path: '/v1/tee/echo',
        requestNonce: 'nonce-123',
        requestBody: { message: 'hello' },
        responseStatus: 200,
        keyId: 'primary',
        privateKeyPem,
        transport: 'tls',
        now,
        ttlSeconds: Number.POSITIVE_INFINITY
      })
    ).toThrow('ttlSeconds must be a positive number');
  });

  it('detects response tampering', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    const envelope = createTeeSecureEnvelope({
      data: {
        message: 'hello',
        receivedAt: '2026-01-02T03:04:05.000Z'
      },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now
    });

    const tamperedEnvelope = {
      ...envelope,
      data: {
        ...envelope.data,
        message: 'tampered'
      }
    };

    const verification = verifyTeeSecureEnvelope({
      envelope: tamperedEnvelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: {
        primary: publicKeyPem
      },
      expectedTransport: 'tls',
      now
    });

    expect(verification.isValid).toBe(false);
    expect(verification.failureCodes).toContain('response_digest_mismatch');
  });

  it('detects stale proofs', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();

    const envelope = createTeeSecureEnvelope({
      data: {
        message: 'hello',
        receivedAt: '2026-01-02T03:04:05.000Z'
      },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now: new Date('2026-01-02T03:04:05.000Z'),
      ttlSeconds: 10
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: {
        primary: publicKeyPem
      },
      expectedTransport: 'tls',
      now: new Date('2026-01-02T03:05:00.000Z')
    });

    expect(verification.isValid).toBe(false);
    expect(verification.failureCodes).toContain('stale_or_future_proof');
  });

  it('rejects envelopes with unknown key ids', () => {
    const { privateKeyPem } = generateSigningKeys();

    const envelope = createTeeSecureEnvelope({
      data: {
        message: 'hello',
        receivedAt: '2026-01-02T03:04:05.000Z'
      },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now: new Date('2026-01-02T03:04:05.000Z')
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: {},
      expectedTransport: 'tls',
      now: new Date('2026-01-02T03:04:05.000Z')
    });

    expect(verification.isValid).toBe(false);
    expect(verification.failureCodes).toContain('missing_trusted_key');
  });

  it('parses JSON envelopes and rejects invalid payloads', () => {
    const parsed = parseTeeSecureEnvelope({
      data: {
        ok: true
      },
      proof: {
        version: 'tee-proof.v1',
        algorithm: 'ed25519',
        keyId: 'primary',
        requestNonce: 'nonce-1',
        requestDigest: 'digest-a',
        responseDigest: 'digest-b',
        transport: 'tls',
        issuedAt: '2026-01-02T03:04:05.000Z',
        expiresAt: '2026-01-02T03:04:35.000Z',
        signature: 'sig'
      }
    });

    expect(parsed.proof.keyId).toBe('primary');

    expect(() => {
      parseTeeSecureEnvelope({
        data: {
          ok: true
        },
        proof: {
          version: 'tee-proof.v1',
          algorithm: 'ed25519',
          keyId: 'primary',
          requestNonce: 'nonce-1',
          requestDigest: 'digest-a',
          responseDigest: 'digest-b',
          transport: 'invalid',
          issuedAt: '2026-01-02T03:04:05.000Z',
          expiresAt: '2026-01-02T03:04:35.000Z',
          signature: 'sig'
        }
      });
    }).toThrowError('proof.transport must be "tls" or "loopback"');
  });
});

describe('attestation policy verification', () => {
  it('accepts valid attestation from trusted provider', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    const envelope = createTeeSecureEnvelope({
      data: { message: 'hello' },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now,
      attestation: {
        provider: 'azure-sev-snp',
        quoteSha256: 'abc123def456'
      }
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: { primary: publicKeyPem },
      expectedTransport: 'tls',
      now,
      attestationPolicy: {
        trustedProviders: ['azure-sev-snp', 'aws-nitro']
      }
    });

    expect(verification.isValid).toBe(true);
    expect(verification.attestationValid).toBe(true);
    expect(verification.failureCodes).toEqual([]);
  });

  it('rejects attestation from untrusted provider', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    const envelope = createTeeSecureEnvelope({
      data: { message: 'hello' },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now,
      attestation: {
        provider: 'unknown-provider',
        quoteSha256: 'abc123def456'
      }
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: { primary: publicKeyPem },
      expectedTransport: 'tls',
      now,
      attestationPolicy: {
        trustedProviders: ['azure-sev-snp', 'aws-nitro']
      }
    });

    expect(verification.isValid).toBe(false);
    expect(verification.attestationValid).toBe(false);
    expect(verification.failureCodes).toContain(
      'untrusted_attestation_provider'
    );
  });

  it('rejects mismatched quote SHA256', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    const envelope = createTeeSecureEnvelope({
      data: { message: 'hello' },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now,
      attestation: {
        provider: 'azure-sev-snp',
        quoteSha256: 'actual-quote-hash'
      }
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: { primary: publicKeyPem },
      expectedTransport: 'tls',
      now,
      attestationPolicy: {
        expectedQuoteSha256s: {
          'azure-sev-snp': 'expected-quote-hash'
        }
      }
    });

    expect(verification.isValid).toBe(false);
    expect(verification.attestationValid).toBe(false);
    expect(verification.failureCodes).toContain('attestation_quote_mismatch');
  });

  it('accepts matching quote SHA256', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    const envelope = createTeeSecureEnvelope({
      data: { message: 'hello' },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now,
      attestation: {
        provider: 'azure-sev-snp',
        quoteSha256: 'expected-quote-hash'
      }
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: { primary: publicKeyPem },
      expectedTransport: 'tls',
      now,
      attestationPolicy: {
        expectedQuoteSha256s: {
          'azure-sev-snp': 'expected-quote-hash'
        }
      }
    });

    expect(verification.isValid).toBe(true);
    expect(verification.attestationValid).toBe(true);
    expect(verification.failureCodes).toEqual([]);
  });

  it('fails when attestation is required but missing', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    const envelope = createTeeSecureEnvelope({
      data: { message: 'hello' },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: { primary: publicKeyPem },
      expectedTransport: 'tls',
      now,
      attestationPolicy: {
        requireAttestation: true
      }
    });

    expect(verification.isValid).toBe(false);
    expect(verification.attestationValid).toBe(false);
    expect(verification.failureCodes).toContain('missing_required_attestation');
  });

  it('allows missing attestation when not required', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    const envelope = createTeeSecureEnvelope({
      data: { message: 'hello' },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: { primary: publicKeyPem },
      expectedTransport: 'tls',
      now,
      attestationPolicy: {
        trustedProviders: ['azure-sev-snp']
      }
    });

    expect(verification.isValid).toBe(true);
    expect(verification.attestationValid).toBe(true);
    expect(verification.failureCodes).toEqual([]);
  });

  it('ignores quote validation for providers not in expectedQuoteSha256s', () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeys();
    const now = new Date('2026-01-02T03:04:05.000Z');

    const envelope = createTeeSecureEnvelope({
      data: { message: 'hello' },
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      keyId: 'primary',
      privateKeyPem,
      transport: 'tls',
      now,
      attestation: {
        provider: 'aws-nitro',
        quoteSha256: 'any-quote-hash'
      }
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce: 'nonce-123',
      requestBody: { message: 'hello' },
      responseStatus: 200,
      trustedPublicKeys: { primary: publicKeyPem },
      expectedTransport: 'tls',
      now,
      attestationPolicy: {
        trustedProviders: ['azure-sev-snp', 'aws-nitro'],
        expectedQuoteSha256s: {
          'azure-sev-snp': 'specific-azure-hash'
        }
      }
    });

    expect(verification.isValid).toBe(true);
    expect(verification.attestationValid).toBe(true);
    expect(verification.failureCodes).toEqual([]);
  });
});

describe('createRequestNonce', () => {
  it('creates nonce with default byte length', () => {
    const nonce = createRequestNonce();
    expect(nonce.length).toBeGreaterThan(0);
  });

  it('throws for byte length less than 16', () => {
    expect(() => createRequestNonce(15)).toThrow(
      'byteLength must be at least 16'
    );
    expect(() => createRequestNonce(8)).toThrow(
      'byteLength must be at least 16'
    );
  });

  it('accepts byte length of 16', () => {
    const nonce = createRequestNonce(16);
    expect(nonce.length).toBeGreaterThan(0);
  });
});

describe('json utilities', () => {
  describe('isJsonValue', () => {
    it('returns true for primitives', () => {
      expect(isJsonValue(null)).toBe(true);
      expect(isJsonValue('string')).toBe(true);
      expect(isJsonValue(42)).toBe(true);
      expect(isJsonValue(true)).toBe(true);
      expect(isJsonValue(false)).toBe(true);
    });

    it('returns true for arrays of valid JSON values', () => {
      expect(isJsonValue([1, 2, 3])).toBe(true);
      expect(isJsonValue(['a', 'b'])).toBe(true);
      expect(isJsonValue([{ nested: true }])).toBe(true);
    });

    it('returns false for arrays with invalid items', () => {
      expect(isJsonValue([undefined])).toBe(false);
      expect(isJsonValue([() => {}])).toBe(false);
    });

    it('returns true for objects with valid values', () => {
      expect(isJsonValue({ key: 'value' })).toBe(true);
    });

    it('returns false for functions', () => {
      expect(isJsonValue(() => {})).toBe(false);
    });
  });

  describe('stableStringify', () => {
    it('handles null', () => {
      expect(stableStringify(null)).toBe('null');
    });

    it('handles booleans', () => {
      expect(stableStringify(true)).toBe('true');
      expect(stableStringify(false)).toBe('false');
    });

    it('handles arrays', () => {
      expect(stableStringify([1, 2, 3])).toBe('[1,2,3]');
      expect(stableStringify(['a', 'b'])).toBe('["a","b"]');
    });

    it('throws for non-finite numbers', () => {
      expect(() =>
        stableStringify(Number.POSITIVE_INFINITY as JsonValue)
      ).toThrow('Non-finite numbers');
      expect(() => stableStringify(Number.NaN as JsonValue)).toThrow(
        'Non-finite numbers'
      );
    });

    it('handles floating point numbers', () => {
      expect(stableStringify(3.14)).toBe('3.14');
    });

    it('throws for undefined object values', () => {
      const obj = { key: undefined } as unknown as JsonValue;
      expect(() => stableStringify(obj)).toThrow('Undefined object values');
    });
  });
});

describe('contracts', () => {
  describe('isTeeEchoRequest', () => {
    it('returns true for valid request', () => {
      expect(isTeeEchoRequest({ message: 'hello' })).toBe(true);
    });

    it('returns false for non-object', () => {
      expect(isTeeEchoRequest('string')).toBe(false);
      expect(isTeeEchoRequest(null)).toBe(false);
      expect(isTeeEchoRequest(undefined)).toBe(false);
    });

    it('returns false for missing message', () => {
      expect(isTeeEchoRequest({})).toBe(false);
    });

    it('returns false for empty message', () => {
      expect(isTeeEchoRequest({ message: '' })).toBe(false);
    });
  });

  describe('parseTeeEchoRequest', () => {
    it('parses valid request', () => {
      const result = parseTeeEchoRequest({ message: 'test' });
      expect(result).toEqual({ message: 'test' });
    });

    it('throws for invalid request', () => {
      expect(() => parseTeeEchoRequest({})).toThrow('Invalid tee echo request');
    });
  });

  describe('isTeeEchoResponse', () => {
    it('returns true for valid response', () => {
      expect(
        isTeeEchoResponse({ message: 'hello', receivedAt: '2026-01-01' })
      ).toBe(true);
    });

    it('returns false for non-object', () => {
      expect(isTeeEchoResponse('string')).toBe(false);
    });

    it('returns false for missing fields', () => {
      expect(isTeeEchoResponse({ message: 'hello' })).toBe(false);
      expect(isTeeEchoResponse({ receivedAt: '2026-01-01' })).toBe(false);
    });
  });

  describe('parseTeeEchoResponse', () => {
    it('parses valid response', () => {
      const result = parseTeeEchoResponse({
        message: 'test',
        receivedAt: '2026-01-01'
      });
      expect(result).toEqual({ message: 'test', receivedAt: '2026-01-01' });
    });

    it('throws for invalid response', () => {
      expect(() => parseTeeEchoResponse({ message: 'test' })).toThrow(
        'Invalid tee echo response'
      );
    });
  });
});

describe('key rotation support', () => {
  const primaryKey: TeeSigningKeyConfig = {
    keyId: 'primary',
    privateKeyPem: 'primary-pem'
  };

  const secondaryKey: TeeSigningKeyConfig = {
    keyId: 'secondary',
    privateKeyPem: 'secondary-pem',
    activatedAt: new Date('2026-01-15T00:00:00.000Z')
  };

  const deprecatedKey: TeeSigningKeyConfig = {
    keyId: 'old',
    privateKeyPem: 'old-pem',
    activatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deprecatedAt: new Date('2026-01-10T00:00:00.000Z')
  };

  it('selects the only available key when single key configured', () => {
    const now = new Date('2026-01-05T00:00:00.000Z');
    const selected = selectActiveSigningKey([primaryKey], 3600, now);
    expect(selected.keyId).toBe('primary');
  });

  it('selects the most recently activated non-deprecated key', () => {
    const now = new Date('2026-01-20T00:00:00.000Z');
    const keys = [primaryKey, secondaryKey];
    const selected = selectActiveSigningKey(keys, 3600, now);
    expect(selected.keyId).toBe('secondary');
  });

  it('excludes keys not yet activated', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const futureKey: TeeSigningKeyConfig = {
      keyId: 'future',
      privateKeyPem: 'future-pem',
      activatedAt: new Date('2026-02-01T00:00:00.000Z')
    };
    const keys = [primaryKey, futureKey];
    const selected = selectActiveSigningKey(keys, 3600, now);
    expect(selected.keyId).toBe('primary');
  });

  it('allows deprecated key during grace window', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T00:30:00.000Z');
    const keys = [deprecatedKey];
    const selected = selectActiveSigningKey(keys, graceWindowSeconds, now);
    expect(selected.keyId).toBe('old');
  });

  it('excludes deprecated key after grace window expires', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T02:00:00.000Z');
    const keys = [deprecatedKey, primaryKey];
    const selected = selectActiveSigningKey(keys, graceWindowSeconds, now);
    expect(selected.keyId).toBe('primary');
  });

  it('throws error when no active keys available', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T02:00:00.000Z');
    const keys = [deprecatedKey];
    expect(() => selectActiveSigningKey(keys, graceWindowSeconds, now)).toThrow(
      'No active signing keys available'
    );
  });

  it('throws error when no keys configured', () => {
    const now = new Date('2026-01-05T00:00:00.000Z');
    expect(() => selectActiveSigningKey([], 3600, now)).toThrow(
      'No signing keys configured'
    );
  });

  it('prefers non-deprecated key over deprecated key in grace window', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T00:30:00.000Z');
    const keys = [deprecatedKey, primaryKey];
    const selected = selectActiveSigningKey(keys, graceWindowSeconds, now);
    expect(selected.keyId).toBe('primary');
  });

  it('uses deprecated key when all keys are deprecated but within grace', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T00:30:00.000Z');
    const allDeprecated: TeeSigningKeyConfig[] = [
      {
        keyId: 'dep1',
        privateKeyPem: 'dep1-pem',
        activatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deprecatedAt: new Date('2026-01-10T00:00:00.000Z')
      },
      {
        keyId: 'dep2',
        privateKeyPem: 'dep2-pem',
        activatedAt: new Date('2026-01-05T00:00:00.000Z'),
        deprecatedAt: new Date('2026-01-10T00:00:00.000Z')
      }
    ];
    const selected = selectActiveSigningKey(
      allDeprecated,
      graceWindowSeconds,
      now
    );
    expect(selected.keyId).toBe('dep2');
  });
});
