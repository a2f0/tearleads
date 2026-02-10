import { isRecord, type RegisterRequest } from '@rapid/shared';
import {
  getAccessTokenTtlSeconds,
  getRefreshTokenTtlSeconds
} from '../../lib/authConfig.js';

export const ACCESS_TOKEN_TTL_SECONDS = getAccessTokenTtlSeconds();
export const REFRESH_TOKEN_TTL_SECONDS = getRefreshTokenTtlSeconds();
export const MIN_PASSWORD_LENGTH = 8;
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export type LoginPayload = {
  email: string;
  password: string;
};

export type RegisterPayload = RegisterRequest;

export type RefreshPayload = {
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
