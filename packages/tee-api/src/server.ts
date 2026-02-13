import { readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http';
import {
  createTeeSecureEnvelope,
  isTeeEchoRequest,
  TEE_ECHO_PATH,
  type TeeAttestationEvidence,
  type TeeTransport
} from './index.js';

interface TeeApiServerConfig {
  host: string;
  port: number;
  keyId: string;
  privateKeyPem: string;
  proofTtlSeconds: number;
  transportMode: TeeTransport | 'auto';
  attestation?: TeeAttestationEvidence;
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: object,
  headers?: Record<string, string>
): void {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));

  if (headers !== undefined) {
    for (const [name, value] of Object.entries(headers)) {
      response.setHeader(name, value);
    }
  }

  response.end(body);
}

function firstHeaderValue(
  header: string | string[] | undefined
): string | undefined {
  if (typeof header === 'string') {
    return header;
  }

  if (Array.isArray(header) && header.length > 0) {
    const [first] = header;
    return first;
  }

  return undefined;
}

function isTlsSocket(request: IncomingMessage): boolean {
  const socketValue: unknown = request.socket;
  if (typeof socketValue !== 'object' || socketValue === null) {
    return false;
  }

  if (!('encrypted' in socketValue)) {
    return false;
  }

  return socketValue.encrypted === true;
}

function resolveTransport(
  request: IncomingMessage,
  mode: TeeApiServerConfig['transportMode']
): TeeTransport {
  if (mode === 'tls' || mode === 'loopback') {
    return mode;
  }

  if (isTlsSocket(request)) {
    return 'tls';
  }

  const forwardedProto = firstHeaderValue(request.headers['x-forwarded-proto']);
  if (
    forwardedProto !== undefined &&
    forwardedProto.toLowerCase() === 'https'
  ) {
    return 'tls';
  }

  return 'loopback';
}

function toBuffer(chunk: unknown): Buffer {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, 'utf8');
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }

  throw new Error('Unsupported request body chunk type');
}

function readRequestBody(
  request: IncomingMessage,
  maxBytes: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    request.on('data', (chunk: unknown) => {
      const buffer = toBuffer(chunk);
      totalBytes += buffer.length;

      if (totalBytes > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes`));
        request.destroy();
        return;
      }

      chunks.push(buffer);
    });

    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    request.on('error', (error: Error) => {
      reject(error);
    });
  });
}

function parseJson(value: string): unknown {
  if (value.trim().length === 0) {
    return {};
  }

  return JSON.parse(value);
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

function envNumber(name: string, defaultValue: number): number {
  const raw = optionalEnv(name);
  if (raw === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readPrivateKeyPem(): string {
  const inlinePem = optionalEnv('TEE_API_SIGNING_PRIVATE_KEY_PEM');
  if (inlinePem !== undefined) {
    return inlinePem;
  }

  const privateKeyPath = optionalEnv('TEE_API_SIGNING_PRIVATE_KEY_PATH');
  if (privateKeyPath !== undefined) {
    return readFileSync(privateKeyPath, 'utf8');
  }

  throw new Error(
    'TEE_API_SIGNING_PRIVATE_KEY_PEM or TEE_API_SIGNING_PRIVATE_KEY_PATH is required'
  );
}

function parseTransportMode(
  value: string | undefined
): TeeApiServerConfig['transportMode'] {
  if (value === undefined || value === 'auto') {
    return 'auto';
  }

  if (value === 'tls' || value === 'loopback') {
    return value;
  }

  throw new Error('TEE_API_TRANSPORT_MODE must be one of: auto, tls, loopback');
}

function readAttestationFromEnv(): TeeAttestationEvidence | undefined {
  const provider = optionalEnv('TEE_API_ATTESTATION_PROVIDER');
  const quoteSha256 = optionalEnv('TEE_API_ATTESTATION_QUOTE_SHA256');

  if (provider === undefined && quoteSha256 === undefined) {
    return undefined;
  }

  if (provider === undefined || quoteSha256 === undefined) {
    throw new Error(
      'TEE_API_ATTESTATION_PROVIDER and TEE_API_ATTESTATION_QUOTE_SHA256 must both be provided'
    );
  }

  return {
    provider,
    quoteSha256
  };
}

export function loadTeeApiServerConfigFromEnv(): TeeApiServerConfig {
  const attestation = readAttestationFromEnv();
  const baseConfig = {
    host: optionalEnv('TEE_API_HOST') ?? '0.0.0.0',
    port: envNumber('TEE_API_PORT', 8080),
    keyId: optionalEnv('TEE_API_SIGNING_KEY_ID') ?? 'tee-primary',
    privateKeyPem: readPrivateKeyPem(),
    proofTtlSeconds: envNumber('TEE_API_PROOF_TTL_SECONDS', 30),
    transportMode: parseTransportMode(optionalEnv('TEE_API_TRANSPORT_MODE'))
  };
  return attestation === undefined
    ? baseConfig
    : {
        ...baseConfig,
        attestation
      };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: TeeApiServerConfig
): Promise<void> {
  const requestMethod = request.method ?? 'GET';
  const requestUrl = new URL(request.url ?? '/', 'http://localhost');

  if (requestMethod === 'GET' && requestUrl.pathname === '/healthz') {
    writeJsonResponse(response, 200, {
      status: 'ok'
    });
    return;
  }

  if (requestMethod === 'POST' && requestUrl.pathname === TEE_ECHO_PATH) {
    const requestNonce = firstHeaderValue(
      request.headers['x-tee-request-nonce']
    );
    if (requestNonce === undefined || requestNonce.length === 0) {
      writeJsonResponse(response, 400, {
        error: 'Missing x-tee-request-nonce header'
      });
      return;
    }

    const rawBody = await readRequestBody(request, 64 * 1024);
    const parsedBody = parseJson(rawBody);

    if (!isTeeEchoRequest(parsedBody)) {
      writeJsonResponse(response, 400, {
        error: 'Invalid request body'
      });
      return;
    }

    const data = {
      message: parsedBody.message,
      receivedAt: new Date().toISOString()
    };

    const envelopeBase = {
      data,
      method: requestMethod,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      requestNonce,
      requestBody: parsedBody,
      responseStatus: 200,
      keyId: config.keyId,
      privateKeyPem: config.privateKeyPem,
      ttlSeconds: config.proofTtlSeconds,
      transport: resolveTransport(request, config.transportMode)
    };
    const envelope = createTeeSecureEnvelope(
      config.attestation === undefined
        ? envelopeBase
        : {
            ...envelopeBase,
            attestation: config.attestation
          }
    );

    writeJsonResponse(response, 200, envelope, {
      'Cache-Control': 'no-store, max-age=0, private',
      Pragma: 'no-cache',
      Expires: '0'
    });
    return;
  }

  writeJsonResponse(response, 404, {
    error: 'Not found'
  });
}

export function createTeeApiServer(config: TeeApiServerConfig): Server {
  return createServer((request, response) => {
    void routeRequest(request, response, config).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Internal error';
      writeJsonResponse(response, 500, {
        error: message
      });
    });
  });
}

export function startTeeApiServer(config: TeeApiServerConfig): Promise<Server> {
  const server = createTeeApiServer(config);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function startFromEnv(): Promise<void> {
  const config = loadTeeApiServerConfigFromEnv();
  await startTeeApiServer(config);
  process.stdout.write(
    `tee-api listening on http://${config.host}:${String(config.port)}\n`
  );
}

const entrypointPath = process.argv[1];
const scriptName = entrypointPath?.split('/').pop();
if (
  scriptName === 'server.ts' ||
  scriptName === 'server.js' ||
  scriptName === 'server.cjs'
) {
  void startFromEnv().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Failed to start tee-api';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
