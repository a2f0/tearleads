import { generateKeyPairSync } from 'node:crypto';
import {
  createTeeSecureEnvelope,
  parseTeeEchoRequest,
  TEE_ECHO_PATH,
  type TeeEchoResponse,
  type TeeTransport
} from '@tearleads/tee-api';
import { HttpResponse, http } from 'msw';

interface TeeApiMswConfig {
  cacheControl: string;
  status: number;
  tamperResponse: boolean;
  transport: TeeTransport | 'auto';
}

const defaultConfig: TeeApiMswConfig = {
  cacheControl: 'no-store, private, max-age=0',
  status: 200,
  tamperResponse: false,
  transport: 'auto'
};

let config: TeeApiMswConfig = {
  ...defaultConfig
};

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
  throw new Error('Unable to export msw signing key pair as PEM strings');
}

const TEE_API_MSW_KEY_ID = 'tee-msw-primary';

export function teeApiMswTrustedPublicKeys(): Record<string, string> {
  return {
    [TEE_API_MSW_KEY_ID]: publicKeyPem
  };
}

export function configureTeeApiMsw(next: Partial<TeeApiMswConfig>): void {
  config = {
    ...config,
    ...next
  };
}

export function resetTeeApiMsw(): void {
  config = {
    ...defaultConfig
  };
}

const teeEchoPathPattern = new RegExp(
  `${TEE_ECHO_PATH.replaceAll('/', '\\/')}$`
);

function resolveTransport(url: URL): TeeTransport {
  if (config.transport !== 'auto') {
    return config.transport;
  }

  if (url.protocol === 'https:') {
    return 'tls';
  }

  return 'loopback';
}

function badRequest(error: string): Response {
  return HttpResponse.json(
    {
      error
    },
    {
      status: 400
    }
  );
}

export const handlers = [
  http.get(/\/healthz$/, () =>
    HttpResponse.json({
      status: 'ok'
    })
  ),
  http.post(teeEchoPathPattern, async ({ request }) => {
    const requestNonce = request.headers.get('x-tee-request-nonce');
    if (requestNonce === null || requestNonce.length === 0) {
      return badRequest('Missing x-tee-request-nonce header');
    }

    const body = await request.json().catch(() => null);

    let parsedRequest: ReturnType<typeof parseTeeEchoRequest>;
    try {
      parsedRequest = parseTeeEchoRequest(body);
    } catch {
      return badRequest('Invalid tee echo request payload');
    }

    const requestUrl = new URL(request.url);
    const responseStatus = config.status;
    const responseBody: TeeEchoResponse = {
      message: parsedRequest.message,
      receivedAt: new Date().toISOString()
    };

    const envelope = createTeeSecureEnvelope({
      data: responseBody,
      method: request.method,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      requestNonce,
      requestBody: parsedRequest,
      responseStatus,
      keyId: TEE_API_MSW_KEY_ID,
      privateKeyPem,
      transport: resolveTransport(requestUrl),
      now: new Date(),
      ttlSeconds: 120
    });

    const payload = config.tamperResponse
      ? {
          ...envelope,
          data: {
            ...envelope.data,
            message: `${envelope.data.message}-tampered`
          }
        }
      : envelope;

    return HttpResponse.json(payload, {
      status: responseStatus,
      headers: {
        'Cache-Control': config.cacheControl
      }
    });
  })
];
