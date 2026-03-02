import { Code } from '@connectrpc/connect';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toConnectCode(status: number): Code {
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

export function errorMessageFromPayload(
  payload: unknown,
  fallback: string
): string {
  if (isRecord(payload)) {
    const value = payload['error'];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return fallback;
}
