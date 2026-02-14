import { TEE_ECHO_PATH } from '@tearleads/tee-api';
import { describe, expect, it } from 'vitest';
import { createTeeApiConsumer } from './teeApiConsumer.js';
import { createTeeClient, TeeClientSecurityError } from './teeClient.js';
import {
  configureTeeApiMsw,
  teeApiMswTrustedPublicKeys
} from './test/msw/handlers.js';

describe('TeeClient', () => {
  it('validates signed responses over HTTPS and returns assertions', async () => {
    const client = createTeeClient({
      baseUrl: 'https://tee.example.com',
      trustedPublicKeys: teeApiMswTrustedPublicKeys()
    });

    const response = await client.request({
      path: TEE_ECHO_PATH,
      method: 'POST',
      body: {
        message: 'hello from client'
      }
    });

    expect(response.assertions.secureAndPrivate).toBe(true);
    expect(response.assertions.responseIsNoStore).toBe(true);
    expect(response.assertions.signatureValid).toBe(true);
    expect(response.assertions.requestBindingValid).toBe(true);
    expect(response.assertions.responseBindingValid).toBe(true);
    expect(response.status).toBe(200);
  });

  it('rejects non-loopback HTTP endpoints', async () => {
    const client = createTeeClient({
      baseUrl: 'http://tee.example.com',
      trustedPublicKeys: teeApiMswTrustedPublicKeys()
    });

    await expect(
      client.request({
        path: '/v1/tee/echo',
        method: 'POST',
        body: {
          message: 'hello'
        }
      })
    ).rejects.toThrowError('Refusing insecure transport');
  });

  it('requires no-store cache directives by default', async () => {
    configureTeeApiMsw({
      cacheControl: 'private, max-age=60'
    });

    const client = createTeeClient({
      baseUrl: 'https://tee.example.com',
      trustedPublicKeys: teeApiMswTrustedPublicKeys()
    });

    await expect(
      client.request({
        path: TEE_ECHO_PATH,
        method: 'POST',
        body: {
          message: 'hello from client'
        }
      })
    ).rejects.toThrowError(TeeClientSecurityError);
  });

  it('detects response tampering', async () => {
    configureTeeApiMsw({
      tamperResponse: true
    });

    const client = createTeeClient({
      baseUrl: 'https://tee.example.com',
      trustedPublicKeys: teeApiMswTrustedPublicKeys()
    });

    let error: unknown;
    try {
      await client.request({
        path: TEE_ECHO_PATH,
        method: 'POST',
        body: {
          message: 'hello from client'
        }
      });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(TeeClientSecurityError);
    if (error instanceof TeeClientSecurityError) {
      expect(error.assertions.verificationFailureCodes).toContain(
        'response_digest_mismatch'
      );
    }
  });

  it('provides a typed consumer for tee-api', async () => {
    const client = createTeeClient({
      baseUrl: 'https://tee.example.com',
      trustedPublicKeys: teeApiMswTrustedPublicKeys()
    });

    const consumer = createTeeApiConsumer(client);
    const result = await consumer.echo('hello from consumer');

    expect(result.response.message).toBe('hello from consumer');
    expect(result.assertions.secureAndPrivate).toBe(true);
  });
});
