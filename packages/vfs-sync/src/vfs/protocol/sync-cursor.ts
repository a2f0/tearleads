export interface VfsSyncCursor {
  changedAt: string;
  changeId: string;
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function encodeBytesToBase64Url(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  let index = 0;

  while (index < bytes.length) {
    const byte1 = bytes[index] ?? 0;
    index += 1;
    const byte2 = index < bytes.length ? bytes[index++] : undefined;
    const byte3 = index < bytes.length ? bytes[index++] : undefined;

    const chunk = (byte1 << 16) | ((byte2 ?? 0) << 8) | (byte3 ?? 0);
    output += chars[(chunk >> 18) & 63];
    output += chars[(chunk >> 12) & 63];
    if (byte2 !== undefined) {
      output += chars[(chunk >> 6) & 63];
    }
    if (byte3 !== undefined) {
      output += chars[chunk & 63];
    }
  }

  return output;
}

function decodeBase64UrlToBytes(base64url: string): Uint8Array | null {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const outputLength = Math.floor((base64url.length * 3) / 4);
  const bytes = new Uint8Array(outputLength);
  let byteIndex = 0;

  for (let index = 0; index < base64url.length; index += 4) {
    const char1 = base64url[index] ?? '';
    const char2 = base64url[index + 1] ?? '';
    const char3 = base64url[index + 2] ?? '';
    const char4 = base64url[index + 3] ?? '';

    const value1 = chars.indexOf(char1);
    const value2 = chars.indexOf(char2);
    const value3 = char3 === '' ? 0 : chars.indexOf(char3);
    const value4 = char4 === '' ? 0 : chars.indexOf(char4);

    if (value1 < 0 || value2 < 0 || value3 < 0 || value4 < 0) return null;

    const chunk = (value1 << 18) | (value2 << 12) | (value3 << 6) | value4;

    bytes[byteIndex++] = (chunk >> 16) & 255;
    if (char3 !== '' && byteIndex < outputLength) {
      bytes[byteIndex++] = (chunk >> 8) & 255;
    }
    if (char4 !== '' && byteIndex < outputLength) {
      bytes[byteIndex++] = chunk & 255;
    }
  }

  return bytes;
}

/**
 * Packs a UUID string into 16 bytes.
 */
function uuidToBytes(uuid: string): Uint8Array | null {
  const hex = uuid.replaceAll('-', '');
  if (hex.length !== 32) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Unpacks 16 bytes into a UUID string.
 */
function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Packs a cursor into a compact binary format (Version 2).
 * [1 byte: version (2)]
 * [8 bytes: timestamp (Int64 MS, BigEndian)]
 * [16 bytes: changeId (UUID bytes)]
 */
export function encodeVfsSyncCursor(cursor: VfsSyncCursor): string {
  const timestamp = Date.parse(cursor.changedAt);
  const uuidBytes = uuidToBytes(cursor.changeId);

  if (!Number.isFinite(timestamp) || !uuidBytes) {
    // Fallback to V1 JSON encoding if we can't pack it (e.g. non-UUID changeId)
    const payload = { version: 1, changedAt: cursor.changedAt, changeId: cursor.changeId };
    return encodeBytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  }

  const bytes = new Uint8Array(1 + 8 + 16);
  bytes[0] = 2; // Version 2

  // Write timestamp as 64-bit BigEndian
  const view = new DataView(bytes.buffer);
  view.setBigInt64(1, BigInt(timestamp), false);

  // Write UUID bytes
  bytes.set(uuidBytes, 9);

  return encodeBytesToBase64Url(bytes);
}

export function decodeVfsSyncCursor(encoded: string): VfsSyncCursor | null {
  try {
    const bytes = decodeBase64UrlToBytes(encoded);
    if (!bytes || bytes.length === 0) return null;

    const version = bytes[0];

    if (version === 2 && bytes.length === 25) {
      const view = new DataView(bytes.buffer);
      const timestamp = Number(view.getBigInt64(1, false));
      const changeId = bytesToUuid(bytes.slice(9, 25));
      
      return {
        changedAt: new Date(timestamp).toISOString(),
        changeId
      };
    }

    // Fallback to V1 JSON decoding
    const decoded = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(decoded);
    if (parsed.version === 1 && isValidIsoTimestamp(parsed.changedAt)) {
      return {
        changedAt: parsed.changedAt,
        changeId: parsed.changeId
      };
    }

    return null;
  } catch {
    return null;
  }
}
