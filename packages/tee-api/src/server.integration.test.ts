import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRequestNonce,
  parseTeeSecureEnvelope,
  stableStringify,
  verifyTeeSecureEnvelope
} from './index.js';
import { startTeeApiServer } from './server.js';

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

describe('tee-api server integration', () => {
  const { privateKeyPem, publicKeyPem } = generateSigningKeys();
  const keyId = 'integration-test-key';

  let server: Awaited<ReturnType<typeof startTeeApiServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startTeeApiServer({
      host: '127.0.0.1',
      port: 0,
      signingKeys: [{ keyId, privateKeyPem }],
      graceWindowSeconds: 3600,
      proofTtlSeconds: 30,
      transportMode: 'loopback'
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('handles echo request and returns valid signed proof', async () => {
    const requestNonce = createRequestNonce();
    const requestBody = { message: 'hello from integration test' };

    const response = await fetch(`${baseUrl}/v1/tee/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tee-Request-Nonce': requestNonce
      },
      body: stableStringify(requestBody)
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');

    const responseJson = await response.json();
    const envelope = parseTeeSecureEnvelope(responseJson);

    expect(envelope.data).toMatchObject({
      message: 'hello from integration test'
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce,
      requestBody,
      responseStatus: 200,
      trustedPublicKeys: { [keyId]: publicKeyPem },
      expectedTransport: 'loopback'
    });

    expect(verification.isValid).toBe(true);
    expect(verification.signatureValid).toBe(true);
    expect(verification.requestDigestMatches).toBe(true);
    expect(verification.responseDigestMatches).toBe(true);
    expect(verification.freshnessValid).toBe(true);
    expect(verification.transportMatches).toBe(true);
    expect(verification.failureCodes).toEqual([]);
  });

  it('verification fails when using wrong public key', async () => {
    const { publicKeyPem: differentPublicKey } = generateSigningKeys();
    const requestNonce = createRequestNonce();
    const requestBody = { message: 'test message' };

    const response = await fetch(`${baseUrl}/v1/tee/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tee-Request-Nonce': requestNonce
      },
      body: stableStringify(requestBody)
    });

    const envelope = parseTeeSecureEnvelope(await response.json());

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce,
      requestBody,
      responseStatus: 200,
      trustedPublicKeys: { 'different-key': differentPublicKey },
      expectedTransport: 'loopback'
    });

    expect(verification.isValid).toBe(false);
    expect(verification.failureCodes).toContain('missing_trusted_key');
  });

  it('healthz endpoint returns ok', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown endpoints', async () => {
    const response = await fetch(`${baseUrl}/unknown`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });

  it('returns 400 when request nonce is missing', async () => {
    const response = await fetch(`${baseUrl}/v1/tee/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' })
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Missing x-tee-request-nonce header' });
  });

  it('returns 400 for invalid request body', async () => {
    const response = await fetch(`${baseUrl}/v1/tee/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tee-Request-Nonce': 'test-nonce'
      },
      body: JSON.stringify({ invalid: 'body' })
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid request body' });
  });

  it('detects response tampering', async () => {
    const requestNonce = createRequestNonce();
    const requestBody = { message: 'test' };

    const response = await fetch(`${baseUrl}/v1/tee/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tee-Request-Nonce': requestNonce
      },
      body: stableStringify(requestBody)
    });

    const responseJson = await response.json();
    const envelope = parseTeeSecureEnvelope(responseJson);

    const tamperedEnvelope = {
      ...envelope,
      data: { message: 'tampered', receivedAt: envelope.data.receivedAt }
    };

    const verification = verifyTeeSecureEnvelope({
      envelope: tamperedEnvelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce,
      requestBody,
      responseStatus: 200,
      trustedPublicKeys: { [keyId]: publicKeyPem },
      expectedTransport: 'loopback'
    });

    expect(verification.isValid).toBe(false);
    expect(verification.failureCodes).toContain('response_digest_mismatch');
  });
});

describe('tee-api server with attestation', () => {
  const { privateKeyPem, publicKeyPem } = generateSigningKeys();
  const keyId = 'attestation-test-key';

  let server: Awaited<ReturnType<typeof startTeeApiServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startTeeApiServer({
      host: '127.0.0.1',
      port: 0,
      signingKeys: [{ keyId, privateKeyPem }],
      graceWindowSeconds: 3600,
      proofTtlSeconds: 30,
      transportMode: 'loopback',
      attestation: {
        provider: 'azure-sev-snp',
        quoteSha256: 'test-quote-hash'
      }
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('includes attestation in proof and validates with policy', async () => {
    const requestNonce = createRequestNonce();
    const requestBody = { message: 'attestation test' };

    const response = await fetch(`${baseUrl}/v1/tee/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tee-Request-Nonce': requestNonce
      },
      body: stableStringify(requestBody)
    });

    const envelope = parseTeeSecureEnvelope(await response.json());

    expect(envelope.proof.attestation).toEqual({
      provider: 'azure-sev-snp',
      quoteSha256: 'test-quote-hash'
    });

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce,
      requestBody,
      responseStatus: 200,
      trustedPublicKeys: { [keyId]: publicKeyPem },
      expectedTransport: 'loopback',
      attestationPolicy: {
        trustedProviders: ['azure-sev-snp'],
        expectedQuoteSha256s: {
          'azure-sev-snp': 'test-quote-hash'
        }
      }
    });

    expect(verification.isValid).toBe(true);
    expect(verification.attestationValid).toBe(true);
  });

  it('rejects when attestation quote does not match policy', async () => {
    const requestNonce = createRequestNonce();
    const requestBody = { message: 'should fail' };

    const response = await fetch(`${baseUrl}/v1/tee/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tee-Request-Nonce': requestNonce
      },
      body: stableStringify(requestBody)
    });

    const envelope = parseTeeSecureEnvelope(await response.json());

    const verification = verifyTeeSecureEnvelope({
      envelope,
      method: 'POST',
      path: '/v1/tee/echo',
      requestNonce,
      requestBody,
      responseStatus: 200,
      trustedPublicKeys: { [keyId]: publicKeyPem },
      expectedTransport: 'loopback',
      attestationPolicy: {
        trustedProviders: ['azure-sev-snp'],
        expectedQuoteSha256s: {
          'azure-sev-snp': 'different-expected-hash'
        }
      }
    });

    expect(verification.isValid).toBe(false);
    expect(verification.attestationValid).toBe(false);
    expect(verification.failureCodes).toContain('attestation_quote_mismatch');
  });
});

describe('tee-api server with key rotation', () => {
  const primaryKeys = generateSigningKeys();
  const secondaryKeys = generateSigningKeys();

  it('uses most recently activated key', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);

    const server = await startTeeApiServer({
      host: '127.0.0.1',
      port: 0,
      signingKeys: [
        {
          keyId: 'old-key',
          privateKeyPem: primaryKeys.privateKeyPem,
          activatedAt: oneHourAgo
        },
        {
          keyId: 'new-key',
          privateKeyPem: secondaryKeys.privateKeyPem,
          activatedAt: now
        }
      ],
      graceWindowSeconds: 3600,
      proofTtlSeconds: 30,
      transportMode: 'loopback'
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const requestNonce = createRequestNonce();
      const requestBody = { message: 'rotation test' };

      const response = await fetch(`${baseUrl}/v1/tee/echo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tee-Request-Nonce': requestNonce
        },
        body: stableStringify(requestBody)
      });

      const envelope = parseTeeSecureEnvelope(await response.json());

      expect(envelope.proof.keyId).toBe('new-key');

      const verificationWithNewKey = verifyTeeSecureEnvelope({
        envelope,
        method: 'POST',
        path: '/v1/tee/echo',
        requestNonce,
        requestBody,
        responseStatus: 200,
        trustedPublicKeys: { 'new-key': secondaryKeys.publicKeyPem },
        expectedTransport: 'loopback'
      });

      expect(verificationWithNewKey.isValid).toBe(true);

      const verificationWithOldKey = verifyTeeSecureEnvelope({
        envelope,
        method: 'POST',
        path: '/v1/tee/echo',
        requestNonce,
        requestBody,
        responseStatus: 200,
        trustedPublicKeys: { 'old-key': primaryKeys.publicKeyPem },
        expectedTransport: 'loopback'
      });

      expect(verificationWithOldKey.isValid).toBe(false);
      expect(verificationWithOldKey.failureCodes).toContain(
        'missing_trusted_key'
      );
    } finally {
      server.close();
    }
  });
});
