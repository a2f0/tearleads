import {
  isRecord,
  PASSWORD_COMPLEXITY_ERROR,
  PASSWORD_MIN_LENGTH,
  passwordMeetsComplexity
} from '@tearleads/shared';
import {
  getAccessTokenTtlSeconds,
  getRefreshTokenTtlSeconds
} from '../../lib/authConfig.js';

export const ACCESS_TOKEN_TTL_SECONDS = getAccessTokenTtlSeconds();
export const REFRESH_TOKEN_TTL_SECONDS = getRefreshTokenTtlSeconds();
// COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity
export const MIN_PASSWORD_LENGTH = PASSWORD_MIN_LENGTH;
export { PASSWORD_COMPLEXITY_ERROR, passwordMeetsComplexity };
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

type LoginPayload = {
  email: string;
  password: string;
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

export function getAllowedEmailDomains(): string[] {
  return (process.env['SMTP_RECIPIENT_DOMAINS'] ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}
