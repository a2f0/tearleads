import { Code, ConnectError } from '@connectrpc/connect';
import { executeRoute } from './legacyRouteProxyExecution.js';
import { isRouteErrorBodyRecord } from './legacyRouteProxyRouting.js';
import type {
  LegacyBinaryResponse,
  LegacyCallOptions,
  RouteExecutionResult
} from './legacyRouteProxyTypes.js';

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

function errorMessageFromResult(result: RouteExecutionResult): string {
  const fallback = `Route handler failed with status ${result.status}`;
  const responseBody = result.body;

  if (typeof responseBody === 'string' && responseBody.trim().length > 0) {
    return responseBody;
  }

  if (!isRouteErrorBodyRecord(responseBody)) {
    return fallback;
  }

  const errorMessage = responseBody['error'];
  if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
    return errorMessage;
  }

  const message = responseBody['message'];
  if (typeof message === 'string' && message.trim().length > 0) {
    return message;
  }

  return fallback;
}

function assertSuccess(result: RouteExecutionResult): void {
  if (result.status >= 200 && result.status < 300) {
    return;
  }

  throw new ConnectError(
    errorMessageFromResult(result),
    toConnectCode(result.status)
  );
}

function toJsonText(body: unknown): string {
  if (body === undefined || body === null) {
    return '{}';
  }

  if (typeof body === 'string') {
    return body.trim().length > 0 ? body : '{}';
  }

  if (body instanceof Uint8Array) {
    const decoded = new TextDecoder().decode(body);
    return decoded.trim().length > 0 ? decoded : '{}';
  }

  const serialized = JSON.stringify(body);
  if (typeof serialized === 'string' && serialized.trim().length > 0) {
    return serialized;
  }

  return '{}';
}

function toBinaryData(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) {
    return body;
  }

  if (typeof body === 'string') {
    return new TextEncoder().encode(body);
  }

  if (
    Array.isArray(body) &&
    body.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return new Uint8Array(body.map((entry) => Math.trunc(entry)));
  }

  return new Uint8Array();
}

export async function callRouteJsonHandler(
  options: LegacyCallOptions
): Promise<string> {
  const result = await executeRoute(options);
  assertSuccess(result);

  if (result.status === 204 || result.status === 205) {
    return '{}';
  }

  return toJsonText(result.body);
}

export async function callRouteBinaryHandler(
  options: LegacyCallOptions
): Promise<LegacyBinaryResponse> {
  const result = await executeRoute(options);
  assertSuccess(result);

  const data = toBinaryData(result.body);
  return {
    data,
    ...(result.contentType ? { contentType: result.contentType } : {})
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
