import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTeeSecureEnvelope, verifyTeeSecureEnvelope } from './index.js';

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
