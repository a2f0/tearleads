import { Buffer } from 'node:buffer';

type EnumNameMap<T extends string> = Record<string, T>;
type EnumNumericMap<T extends string> = Record<number, T>;

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBase64WithoutPadding(value: string): string {
  return value.replace(/=+$/u, '');
}

function decodeBase64ToBytes(value: string): Uint8Array | null {
  const normalized = value
    .replace(/\s+/gu, '')
    .replace(/-/gu, '+')
    .replace(/_/gu, '/');
  if (normalized.length === 0 || /[^A-Za-z0-9+/=]/u.test(normalized)) {
    return null;
  }

  const remainder = normalized.length % 4;
  if (remainder === 1) {
    return null;
  }

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

function parseOptionalBytes(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (Array.isArray(value)) {
    const output: number[] = [];
    for (const candidate of value) {
      if (
        typeof candidate !== 'number' ||
        !Number.isInteger(candidate) ||
        candidate < 0 ||
        candidate > 255
      ) {
        return null;
      }

      output.push(candidate);
    }
    return new Uint8Array(output);
  }

  if (typeof value === 'string') {
    return decodeBase64ToBytes(value);
  }

  return null;
}

function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

function bytesToIdentifier(bytes: Uint8Array): string {
  if (bytes.length === 16) {
    return bytesToUuid(bytes);
  }

  return new TextDecoder().decode(bytes);
}

export function parseIdentifierWithCompactFallback(
  stringValue: unknown,
  bytesValue: unknown
): string | null {
  const parsedString = normalizeRequiredString(stringValue);
  if (parsedString) {
    return parsedString;
  }

  const parsedBytes = parseOptionalBytes(bytesValue);
  if (!parsedBytes || parsedBytes.length === 0) {
    return null;
  }

  const identifier = bytesToIdentifier(parsedBytes).trim();
  return identifier.length > 0 ? identifier : null;
}

function parseIntegerLike(value: unknown): number | null {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) {
      return value;
    }
    return null;
  }

  if (typeof value === 'bigint') {
    if (
      value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      value >= BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return Number(value);
    }
    return null;
  }

  if (typeof value === 'string' && /^-?[0-9]+$/u.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function parsePositiveSafeIntegerWithCompactFallback(
  value: unknown,
  compactValue: unknown
): number | null {
  const parsedValue = parseIntegerLike(value);
  if (parsedValue !== null) {
    return parsedValue >= 1 ? parsedValue : null;
  }

  const parsedCompactValue = parseIntegerLike(compactValue);
  if (parsedCompactValue !== null) {
    return parsedCompactValue >= 1 ? parsedCompactValue : null;
  }

  return null;
}

export function parseOccurredAtWithCompactFallback(
  value: unknown,
  occurredAtMs: unknown
): string | null {
  const parsedString = normalizeRequiredString(value);
  if (parsedString) {
    const parsedMs = Date.parse(parsedString);
    if (Number.isFinite(parsedMs)) {
      return new Date(parsedMs).toISOString();
    }
    return null;
  }

  const parsedCompactValue = parseIntegerLike(occurredAtMs);
  if (parsedCompactValue === null || parsedCompactValue < 0) {
    return null;
  }

  return new Date(parsedCompactValue).toISOString();
}

export function parseEnumWithCompactFallback<T extends string>(
  value: unknown,
  compactValue: unknown,
  options: {
    isLegacyValue: (candidate: unknown) => candidate is T;
    numericMap: EnumNumericMap<T>;
    nameMap: EnumNameMap<T>;
    allowUnspecified?: boolean;
  }
): T | null {
  if (options.isLegacyValue(value)) {
    return value;
  }

  if (compactValue === undefined || compactValue === null) {
    return null;
  }

  if (typeof compactValue === 'string') {
    const byName = options.nameMap[compactValue];
    if (byName) {
      return byName;
    }
  }

  const parsedEnumNumber = parseIntegerLike(compactValue);
  if (parsedEnumNumber === null) {
    return null;
  }

  if (options.allowUnspecified && parsedEnumNumber === 0) {
    return null;
  }

  return options.numericMap[parsedEnumNumber] ?? null;
}
