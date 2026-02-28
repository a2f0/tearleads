interface VfsSyncCursorPayload {
  version: 1;
  changedAt: string;
  changeId: string;
}

export interface VfsSyncCursor {
  changedAt: string;
  changeId: string;
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let index = 0;

  while (index < bytes.length) {
    const byte1 = bytes[index++];
    const byte2 = index < bytes.length ? bytes[index++] : undefined;
    const byte3 = index < bytes.length ? bytes[index++] : undefined;

    const chunk = (byte1 << 16) | ((byte2 ?? 0) << 8) | (byte3 ?? 0);
    output += chars[(chunk >> 18) & 63];
    output += chars[(chunk >> 12) & 63];
    output += byte2 === undefined ? '=' : chars[(chunk >> 6) & 63];
    output += byte3 === undefined ? '=' : chars[chunk & 63];
  }

  return output;
}

function decodeBase64ToBytes(base64: string): Uint8Array | null {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (base64.length % 4 !== 0) {
    return null;
  }

  const paddingMatches = base64.match(/=+$/);
  const paddingLength = paddingMatches ? paddingMatches[0].length : 0;
  if (paddingLength > 2) {
    return null;
  }

  const outputLength = (base64.length / 4) * 3 - paddingLength;
  const bytes = new Uint8Array(outputLength);
  let byteIndex = 0;

  for (let index = 0; index < base64.length; index += 4) {
    const char1 = base64[index];
    const char2 = base64[index + 1];
    const char3 = base64[index + 2];
    const char4 = base64[index + 3];

    const value1 = chars.indexOf(char1);
    const value2 = chars.indexOf(char2);
    const value3 = char3 === '=' ? 0 : chars.indexOf(char3);
    const value4 = char4 === '=' ? 0 : chars.indexOf(char4);
    if (value1 < 0 || value2 < 0 || value3 < 0 || value4 < 0) {
      return null;
    }

    const chunk = (value1 << 18) | (value2 << 12) | (value3 << 6) | value4;

    bytes[byteIndex++] = (chunk >> 16) & 255;
    if (char3 !== '=' && byteIndex <= outputLength) {
      bytes[byteIndex++] = (chunk >> 8) & 255;
    }
    if (char4 !== '=' && byteIndex <= outputLength) {
      bytes[byteIndex++] = chunk & 255;
    }
  }

  return bytes;
}

function encodeBase64UrlUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return encodeBytesToBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64UrlUtf8(input: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(input)) {
    return null;
  }

  const normalized = input.replaceAll('-', '+').replaceAll('_', '/');
  const remainder = normalized.length % 4;
  const padded =
    remainder === 0 ? normalized : `${normalized}${'='.repeat(4 - remainder)}`;
  const bytes = decodeBase64ToBytes(padded);
  if (!bytes) {
    return null;
  }

  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeVfsSyncCursor(cursor: VfsSyncCursor): string {
  const payload: VfsSyncCursorPayload = {
    version: 1,
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };

  return encodeBase64UrlUtf8(JSON.stringify(payload));
}

export function decodeVfsSyncCursor(cursor: string): VfsSyncCursor | null {
  try {
    const decoded = decodeBase64UrlUtf8(cursor);
    if (!decoded) {
      return null;
    }
    const parsed: unknown = JSON.parse(decoded);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      !('changedAt' in parsed) ||
      !('changeId' in parsed)
    ) {
      return null;
    }

    const version = parsed['version'];
    const changedAt = parsed['changedAt'];
    const changeId = parsed['changeId'];

    if (
      version !== 1 ||
      typeof changedAt !== 'string' ||
      typeof changeId !== 'string' ||
      !changedAt.trim() ||
      !changeId.trim() ||
      !isValidIsoTimestamp(changedAt)
    ) {
      return null;
    }

    return {
      changedAt,
      changeId
    };
  } catch {
    return null;
  }
}
