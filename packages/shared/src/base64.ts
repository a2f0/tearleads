function normalizeBase64(value: string): string {
  return value.trim().replace(/\s+/gu, '');
}

function trimBase64Padding(value: string): string {
  return value.replace(/=+$/u, '');
}

export function bytesToBase64(value: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < value.length; index += chunkSize) {
    binary += String.fromCharCode(...value.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array | null {
  const normalized = normalizeBase64(value);
  if (/[^A-Za-z0-9+/=]/u.test(normalized)) {
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

  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    return null;
  }

  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  if (
    trimBase64Padding(bytesToBase64(bytes)) !== trimBase64Padding(normalized)
  ) {
    return null;
  }

  return bytes;
}
