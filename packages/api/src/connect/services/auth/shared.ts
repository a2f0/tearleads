import { type Timestamp, timestampFromDate } from '@bufbuild/protobuf/wkt';
import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect';
import {
  isRecord,
  PASSWORD_COMPLEXITY_ERROR,
  PASSWORD_MIN_LENGTH,
  passwordMeetsComplexity,
  type VfsKeySetupRequest
} from '@tearleads/shared';
import {
  AuthService,
  type AuthServiceDeleteSessionRequest
} from '@tearleads/shared/gen/tearleads/v2/auth_pb';
import {
  getAccessTokenTtlSeconds,
  getRefreshTokenTtlSeconds
} from '../../../lib/authConfig.js';
import type { ConnectAuthContext } from '../../context.js';

export const ACCESS_TOKEN_TTL_SECONDS = getAccessTokenTtlSeconds();
export const REFRESH_TOKEN_TTL_SECONDS = getRefreshTokenTtlSeconds();
const REFRESH_COOKIE_NAME = 'tearleads_refresh_token';
const REFRESH_COOKIE_PATH = `/connect/${AuthService.typeName}`;
// COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity
export const MIN_PASSWORD_LENGTH = PASSWORD_MIN_LENGTH;
export { PASSWORD_COMPLEXITY_ERROR, passwordMeetsComplexity };
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

type LoginPayload = {
  email: string;
  password: string;
};

type RegisterPayload = LoginPayload & {
  vfsKeySetup?: VfsKeySetupRequest;
};

type ParseRegisterPayloadResult =
  | {
      ok: true;
      value: RegisterPayload;
    }
  | {
      ok: false;
      error: 'INVALID_AUTH_PAYLOAD' | 'INVALID_VFS_KEY_SETUP';
    };

type RefreshPayload = {
  refreshToken: string;
};

export function parseAuthPayload(body: unknown): LoginPayload | null {
  if (!isRecord(body)) {
    return null;
  }
  const emailValue = body['email'];
  const passwordValue = body['password'];
  if (typeof emailValue !== 'string' || typeof passwordValue !== 'string') {
    return null;
  }
  const email = emailValue.trim().toLowerCase();
  const password = passwordValue.trim();
  if (!email || !password) {
    return null;
  }
  return { email, password };
}

function parseOptionalVfsKeySetupPayload(
  value: unknown
): VfsKeySetupRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const publicEncryptionKey = value['publicEncryptionKey'];
  const publicSigningKey = value['publicSigningKey'];
  const encryptedPrivateKeys = value['encryptedPrivateKeys'];
  const argon2Salt = value['argon2Salt'];

  if (
    typeof publicEncryptionKey !== 'string' ||
    (publicSigningKey != null && typeof publicSigningKey !== 'string') ||
    typeof encryptedPrivateKeys !== 'string' ||
    typeof argon2Salt !== 'string'
  ) {
    return null;
  }

  if (
    !publicEncryptionKey.trim() ||
    !encryptedPrivateKeys.trim() ||
    !argon2Salt.trim()
  ) {
    return null;
  }

  return {
    publicEncryptionKey: publicEncryptionKey.trim(),
    publicSigningKey:
      typeof publicSigningKey === 'string' ? publicSigningKey.trim() : '',
    encryptedPrivateKeys: encryptedPrivateKeys.trim(),
    argon2Salt: argon2Salt.trim()
  };
}

export function parseRegisterPayload(
  body: unknown
): ParseRegisterPayloadResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      error: 'INVALID_AUTH_PAYLOAD'
    };
  }

  const parsedAuth = parseAuthPayload(body);
  if (!parsedAuth) {
    return {
      ok: false,
      error: 'INVALID_AUTH_PAYLOAD'
    };
  }

  const rawVfsKeySetup = body['vfsKeySetup'];
  if (rawVfsKeySetup === undefined) {
    return {
      ok: true,
      value: parsedAuth
    };
  }

  const parsedVfsKeySetup = parseOptionalVfsKeySetupPayload(rawVfsKeySetup);
  if (!parsedVfsKeySetup) {
    return {
      ok: false,
      error: 'INVALID_VFS_KEY_SETUP'
    };
  }

  return {
    ok: true,
    value: {
      ...parsedAuth,
      vfsKeySetup: parsedVfsKeySetup
    }
  };
}

export function parseRefreshPayload(body: unknown): RefreshPayload | null {
  if (!isRecord(body)) {
    return null;
  }
  const refreshToken = body['refreshToken'];
  if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
    return null;
  }
  return { refreshToken: refreshToken.trim() };
}

function isRefreshCookieSecure(): boolean {
  const explicitSecure = process.env['AUTH_REFRESH_COOKIE_SECURE'];
  if (explicitSecure === 'true') {
    return true;
  }
  if (explicitSecure === 'false') {
    return false;
  }
  return process.env['NODE_ENV'] === 'production';
}

function buildRefreshCookie(
  refreshToken: string,
  maxAgeSeconds: number
): string {
  const parts = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`,
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeSeconds)))}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (isRefreshCookieSecure()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function buildClearRefreshCookie(): string {
  const parts = [
    `${REFRESH_COOKIE_NAME}=`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    `Path=${REFRESH_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (isRefreshCookieSecure()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function setRefreshTokenCookie(
  context: HandlerContext,
  refreshToken: string
): void {
  context.responseHeader.append(
    'Set-Cookie',
    buildRefreshCookie(refreshToken, REFRESH_TOKEN_TTL_SECONDS)
  );
}

export function clearRefreshTokenCookie(context: HandlerContext): void {
  context.responseHeader.append('Set-Cookie', buildClearRefreshCookie());
}

export function getRefreshTokenFromCookie(
  requestHeader: Headers
): string | null {
  const cookieHeader = requestHeader.get('cookie');
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = part.trim().split('=');
    const cookieName = rawName?.trim();
    if (cookieName !== REFRESH_COOKIE_NAME) {
      continue;
    }
    const rawValue = rawValueParts.join('=').trim();
    if (!rawValue) {
      return null;
    }
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

export function getAllowedEmailDomains(): string[] {
  return (process.env['SMTP_RECIPIENT_DOMAINS'] ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

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

export function toRequiredTimestamp(
  value: string | null | undefined
): Timestamp {
  if (!value) {
    throw new ConnectError(
      'A required timestamp value is missing',
      Code.Internal
    );
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    throw new ConnectError('Invalid session timestamp', Code.Internal);
  }
  return timestampFromDate(new Date(parsedMs));
}

export function toOptionalTimestamp(
  value: string | null | undefined
): Timestamp | undefined {
  if (!value) {
    return undefined;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return undefined;
  }
  return timestampFromDate(new Date(parsedMs));
}

export function parseRequiredSessionId(
  request: AuthServiceDeleteSessionRequest
): string {
  const sessionId = request.sessionId.trim();
  if (sessionId.length === 0) {
    throw new ConnectError('Session ID is required', Code.InvalidArgument);
  }
  return sessionId;
}
