import { Code, ConnectError } from '@connectrpc/connect';

type LegacyHandlerContext = {
  requestHeader: Headers;
};

interface LegacyCallOptions {
  context: LegacyHandlerContext;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: URLSearchParams;
  jsonBody?: string;
  extraHeaders?: Record<string, string>;
}

interface LegacyBinaryResponse {
  data: Uint8Array;
  contentType?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toConnectCode(status: number): Code {
  if (status === 400) {
    return Code.InvalidArgument;
  }
  if (status === 401) {
    return Code.Unauthenticated;
  }
  if (status === 403) {
    return Code.PermissionDenied;
  }
  if (status === 404) {
    return Code.NotFound;
  }
  if (status === 409) {
    return Code.AlreadyExists;
  }
  if (status === 412) {
    return Code.FailedPrecondition;
  }
  if (status === 429) {
    return Code.ResourceExhausted;
  }
  if (status === 501) {
    return Code.Unimplemented;
  }
  if (status === 503) {
    return Code.Unavailable;
  }
  if (status === 504) {
    return Code.DeadlineExceeded;
  }
  if (status >= 500) {
    return Code.Internal;
  }
  return Code.Unknown;
}

function getLegacyBaseUrl(context: LegacyHandlerContext): string {
  const configured = process.env['CONNECT_LEGACY_BASE_URL'];
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/+$/u, '');
  }

  if (process.env['NODE_ENV'] === 'test') {
    const host = context.requestHeader.get('host');
    if (host && host.trim().length > 0) {
      return `http://${host}/v1`;
    }
  }

  const port = process.env['PORT'] ?? '5001';
  return `http://127.0.0.1:${port}/v1`;
}

function createForwardHeaders(
  context: LegacyHandlerContext,
  extraHeaders: Record<string, string> | undefined
): Headers {
  const headers = new Headers();

  const authorization = context.requestHeader.get('authorization');
  if (authorization && authorization.trim().length > 0) {
    headers.set('authorization', authorization);
  }

  const organizationId = context.requestHeader.get('x-organization-id');
  if (organizationId && organizationId.trim().length > 0) {
    headers.set('x-organization-id', organizationId);
  }

  for (const [headerName, headerValue] of Object.entries(extraHeaders ?? {})) {
    if (headerValue.trim().length > 0) {
      headers.set(headerName, headerValue);
    }
  }

  return headers;
}

async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = `Legacy route proxy failed with status ${response.status}`;
  const bodyText = await response.text();
  if (bodyText.trim().length === 0) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed)) {
      const message = parsed['error'];
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }
    }
  } catch {
    // If the response body is not JSON, fall back to raw text below.
  }

  return bodyText;
}

async function callLegacyRoute(options: LegacyCallOptions): Promise<Response> {
  const { context, method, path, query, jsonBody, extraHeaders } = options;
  const queryString = query && query.toString().length > 0 ? `?${query}` : '';
  const url = `${getLegacyBaseUrl(context)}${path}${queryString}`;

  const headers = createForwardHeaders(context, extraHeaders);
  const init: RequestInit = {
    method,
    headers
  };

  if (jsonBody !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = jsonBody;
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    console.error('Legacy route proxy network failure', error);
    throw new ConnectError('Failed to call legacy route', Code.Unavailable);
  }

  if (!response.ok) {
    throw new ConnectError(
      await responseErrorMessage(response),
      toConnectCode(response.status)
    );
  }

  return response;
}

export async function callLegacyJsonRoute(
  options: LegacyCallOptions
): Promise<string> {
  const response = await callLegacyRoute(options);
  if (response.status === 204 || response.status === 205) {
    return '{}';
  }

  const text = await response.text();
  return text.trim().length > 0 ? text : '{}';
}

export async function callLegacyBinaryRoute(
  options: LegacyCallOptions
): Promise<LegacyBinaryResponse> {
  const response = await callLegacyRoute(options);
  const data = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? undefined;
  return {
    data,
    ...(contentType ? { contentType } : {})
  };
}

export function toJsonBody(json: string): string {
  return json.trim().length > 0 ? json : '{}';
}

export function encoded(value: string): string {
  return encodeURIComponent(value);
}

export function setOptionalStringQueryParam(
  params: URLSearchParams,
  key: string,
  value: string
): void {
  if (value.trim().length > 0) {
    params.set(key, value);
  }
}

export function setOptionalPositiveIntQueryParam(
  params: URLSearchParams,
  key: string,
  value: number
): void {
  if (Number.isFinite(value) && value > 0) {
    params.set(key, String(Math.floor(value)));
  }
}

export function setOptionalNonNegativeIntQueryParam(
  params: URLSearchParams,
  key: string,
  value: number
): void {
  if (Number.isFinite(value) && value >= 0) {
    params.set(key, String(Math.floor(value)));
  }
}
