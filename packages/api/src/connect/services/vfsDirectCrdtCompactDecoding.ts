import { Buffer } from 'node:buffer';

export function decodeBase64ToBytes(value: string): Uint8Array | null {
  const normalized = value
    .replace(/\s+/gu, '')
    .replace(/-/gu, '+')
    .replace(/_/gu, '/');
  if (normalized.length === 0 || /[^A-Za-z0-9+/=]/u.test(normalized)) {
    return null;
  }

  const remainder = normalized.length % 4;
  if (remainder === 1) return null;

  const padded =
    remainder === 0
      ? normalized
      : normalized.padEnd(normalized.length + (4 - remainder), '=');

  try {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  } catch {
    return null;
  }
}

export function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

export function parseIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const bytes = decodeBase64ToBytes(trimmed);
  if (bytes) {
    if (bytes.length === 16) {
      return bytesToUuid(bytes);
    }
    return new TextDecoder().decode(bytes);
  }

  return trimmed;
}

export function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}
