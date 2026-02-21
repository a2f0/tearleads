import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createTeeSecureEnvelope,
  type JsonValue,
  parseTeeSecureEnvelope,
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
