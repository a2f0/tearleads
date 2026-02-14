import {
  createRequestNonce,
  type JsonValue,
  parseTeeSecureEnvelope,
  stableStringify,
  type TeeAttestationPolicy,
  type TeeTransport,
  type TeeVerificationFailureCode,
  verifyTeeSecureEnvelope
} from '@tearleads/tee-api';

export interface TeeClientConfig {
  baseUrl: string;
  trustedPublicKeys: Record<string, string>;
  fetchImpl?: typeof fetch;
  allowInsecureLoopback?: boolean;
  requireNoStoreCacheControl?: boolean;
  maxClockSkewSeconds?: number;
  attestationPolicy?: TeeAttestationPolicy;
}

export interface TeeClientRequestOptions {
  path: string;
  method?: string;
  body?: JsonValue;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface TeeSecurityAssertions {
  transportIsPrivate: boolean;
  responseIsNoStore: boolean;
  signatureValid: boolean;
  requestBindingValid: boolean;
  responseBindingValid: boolean;
  freshnessValid: boolean;
  transportBindingValid: boolean;
  attestationValid: boolean;
  verificationFailureCodes: TeeVerificationFailureCode[];
  secureAndPrivate: boolean;
}

export interface TeeClientResponse {
  data: JsonValue;
  status: number;
  assertions: TeeSecurityAssertions;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  );
}

function hasNoStoreDirective(cacheControlHeader: string | null): boolean {
  if (cacheControlHeader === null) {
    return false;
  }

  const directives = cacheControlHeader
    .split(',')
    .map((directive) => directive.trim().toLowerCase());

  return directives.includes('no-store');
}

function normalizeMethod(method: string | undefined, hasBody: boolean): string {
  if (method !== undefined && method.length > 0) {
    return method.toUpperCase();
  }

  return hasBody ? 'POST' : 'GET';
}

function resolveExpectedTransport(
  url: URL,
  allowInsecureLoopback: boolean
): TeeTransport | undefined {
  if (url.protocol === 'https:') {
    return 'tls';
  }

  if (
    url.protocol === 'http:' &&
    allowInsecureLoopback &&
    isLoopbackHost(url.hostname)
  ) {
    return 'loopback';
  }

  return undefined;
}

function toHeadersRecord(headers: Record<string, string> | undefined): Headers {
  const normalizedHeaders = new Headers();

  if (headers !== undefined) {
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders.set(key, value);
    }
  }

  return normalizedHeaders;
}

export class TeeClientSecurityError extends Error {
  readonly assertions: TeeSecurityAssertions;

  constructor(message: string, assertions: TeeSecurityAssertions) {
    super(message);
    this.name = 'TeeClientSecurityError';
    this.assertions = assertions;
  }
}

export class TeeClient {
  private readonly baseUrl: URL;
  private readonly trustedPublicKeys: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly allowInsecureLoopback: boolean;
  private readonly requireNoStoreCacheControl: boolean;
  private readonly maxClockSkewSeconds: number;
  private readonly attestationPolicy: TeeAttestationPolicy | undefined;

  constructor(config: TeeClientConfig) {
    this.baseUrl = new URL(config.baseUrl);
    this.trustedPublicKeys = config.trustedPublicKeys;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.allowInsecureLoopback = config.allowInsecureLoopback ?? true;
    this.requireNoStoreCacheControl = config.requireNoStoreCacheControl ?? true;
    this.maxClockSkewSeconds = config.maxClockSkewSeconds ?? 5;
    this.attestationPolicy = config.attestationPolicy;
  }

  async request(options: TeeClientRequestOptions): Promise<TeeClientResponse> {
    const hasBody = options.body !== undefined;
    const method = normalizeMethod(options.method, hasBody);
    const url = new URL(options.path, this.baseUrl);

    const expectedTransport = resolveExpectedTransport(
      url,
      this.allowInsecureLoopback
    );

    if (expectedTransport === undefined) {
      throw new TeeClientSecurityError(
        `Refusing insecure transport for ${url.toString()}`,
        {
          transportIsPrivate: false,
          responseIsNoStore: false,
          signatureValid: false,
          requestBindingValid: false,
          responseBindingValid: false,
          freshnessValid: false,
          transportBindingValid: false,
          attestationValid: false,
          verificationFailureCodes: [],
          secureAndPrivate: false
        }
      );
    }

    const requestNonce = createRequestNonce();
    const headers = toHeadersRecord(options.headers);
    headers.set('Accept', 'application/json');
    headers.set('X-Tee-Request-Nonce', requestNonce);

    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = stableStringify(options.body);
    }

    const requestInit: RequestInit = {
      method,
      headers
    };
    if (body !== undefined) {
      requestInit.body = body;
    }
    if (options.signal !== undefined) {
      requestInit.signal = options.signal;
    }

    const response = await this.fetchImpl(url.toString(), requestInit);

    const responseJson = await response.json();
    const envelope = parseTeeSecureEnvelope(responseJson);
    const verification = verifyTeeSecureEnvelope({
      envelope,
      method,
      path: `${url.pathname}${url.search}`,
      requestNonce,
      requestBody: options.body,
      responseStatus: response.status,
      trustedPublicKeys: this.trustedPublicKeys,
      expectedTransport,
      maxClockSkewSeconds: this.maxClockSkewSeconds,
      ...(this.attestationPolicy !== undefined && {
        attestationPolicy: this.attestationPolicy
      })
    });

    const responseIsNoStore =
      !this.requireNoStoreCacheControl ||
      hasNoStoreDirective(response.headers.get('cache-control'));

    const assertions: TeeSecurityAssertions = {
      transportIsPrivate: true,
      responseIsNoStore,
      signatureValid: verification.signatureValid,
      requestBindingValid: verification.requestDigestMatches,
      responseBindingValid: verification.responseDigestMatches,
      freshnessValid: verification.freshnessValid,
      transportBindingValid: verification.transportMatches,
      attestationValid: verification.attestationValid,
      verificationFailureCodes: verification.failureCodes,
      secureAndPrivate: verification.isValid && responseIsNoStore
    };

    if (!assertions.secureAndPrivate) {
      throw new TeeClientSecurityError(
        `Security validation failed for ${url.toString()}`,
        assertions
      );
    }

    if (!response.ok) {
      throw new Error(
        `API request failed with status ${String(response.status)}`
      );
    }

    return {
      data: envelope.data,
      status: response.status,
      assertions
    };
  }
}

export function createTeeClient(config: TeeClientConfig): TeeClient {
  return new TeeClient(config);
}
