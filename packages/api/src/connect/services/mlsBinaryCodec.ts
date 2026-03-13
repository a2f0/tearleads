function normalizeBase64(value: string): string {
  return value.trim().replace(/\s+/gu, '');
}

function trimBase64Padding(value: string): string {
  return value.replace(/=+$/u, '');
}

export function decodeBase64ToBytes(value: string): Uint8Array | null {
  const normalized = normalizeBase64(value);
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

  const decoded = Buffer.from(padded, 'base64');
  if (decoded.length === 0) {
    return null;
  }

  const roundTrip = trimBase64Padding(Buffer.from(decoded).toString('base64'));
  if (roundTrip !== trimBase64Padding(normalized)) {
    return null;
  }

  return Uint8Array.from(decoded);
}

export function toUint8Array(
  value: Buffer | Uint8Array | null
): Uint8Array | null {
  if (value === null) {
    return null;
  }
  return Uint8Array.from(value);
}
