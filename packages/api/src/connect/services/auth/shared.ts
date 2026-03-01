import { Timestamp } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import type { DeleteSessionRequest } from '@tearleads/shared/gen/tearleads/v1/auth_pb';
import type { ConnectAuthContext } from '../../context.js';

export function getClientIpFromHeaders(requestHeader: Headers): string {
  const forwardedFor = requestHeader.get('x-forwarded-for');
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = requestHeader.get('x-real-ip');
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }

  return '127.0.0.1';
}

export function getJwtSecretOrThrow(errorMessage: string): string {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new ConnectError(errorMessage, Code.Internal);
  }
  return jwtSecret;
}

export function getAuthContextOrThrow(context: {
  values: ConnectAuthContext | null;
}): ConnectAuthContext {
  const authContext = context.values;
  if (!authContext) {
    throw new ConnectError('Unauthorized', Code.Unauthenticated);
  }
  return authContext;
}

export function toRequiredTimestamp(value: string): Timestamp {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    throw new ConnectError('Invalid session timestamp', Code.Internal);
  }
  return Timestamp.fromDate(new Date(parsedMs));
}

export function toOptionalTimestamp(value: string): Timestamp | undefined {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return undefined;
  }
  return Timestamp.fromDate(new Date(parsedMs));
}

export function parseRequiredSessionId(request: DeleteSessionRequest): string {
  const sessionId = request.sessionId.trim();
  if (sessionId.length === 0) {
    throw new ConnectError('Session ID is required', Code.InvalidArgument);
  }
  return sessionId;
}
