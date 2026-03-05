export function stringToProtoBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function normalizeBase64(value: string): string {
  return value.trim().replace(/\s+/gu, '');
}

function trimBase64Padding(value: string): string {
  return value.replace(/=+$/u, '');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array | null {
  const normalized = normalizeBase64(value);
  if (normalized.length === 0) {
    return null;
  }

  try {
    const binary = atob(normalized);
    const decoded = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    );
    if (
      trimBase64Padding(bytesToBase64(decoded)) !==
      trimBase64Padding(normalized)
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function decodeTransportBytes(value: string): Uint8Array {
  const decoded = base64ToBytes(value);
  if (decoded) {
    return decoded;
  }
  return new TextEncoder().encode(value);
}
