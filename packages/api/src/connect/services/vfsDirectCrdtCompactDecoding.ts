import { Buffer } from 'node:buffer';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const OPAQUE_IDENTIFIER_PATTERN = /^[a-z0-9:-]+$/u;

function toBase64WithoutPadding(value: string): string {
  return value.replace(/=+$/u, '');
}

export function decodeBase64ToBytes(value: string): Uint8Array | null {
  const normalized = value.replace(/\s+/gu, '');
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
    const bytes = new Uint8Array(Buffer.from(padded, 'base64'));
    if (
      toBase64WithoutPadding(Buffer.from(bytes).toString('base64')) !==
      toBase64WithoutPadding(normalized)
    ) {
      return null;
    }
    return bytes;
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

function isOpaqueIdentifier(value: string): boolean {
  return OPAQUE_IDENTIFIER_PATTERN.test(value);
}

function decodeIdentifier(value: string): string | null {
  const bytes = decodeBase64ToBytes(value);
  if (!bytes) {
    return null;
  }

  if (bytes.length === 16) {
    return bytesToUuid(bytes);
  }

  const decoded = new TextDecoder().decode(bytes);
  if (decoded.length === 0) {
    return null;
  }

  return UUID_PATTERN.test(decoded) || isOpaqueIdentifier(decoded)
    ? decoded
    : null;
}

export function parseIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (UUID_PATTERN.test(trimmed) || isOpaqueIdentifier(trimmed)) {
    return trimmed;
  }

  return decodeIdentifier(trimmed) ?? trimmed;
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
