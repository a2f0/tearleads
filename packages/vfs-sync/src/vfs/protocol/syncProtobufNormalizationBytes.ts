export function encodeBytesToBase64(value: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x2000;

  for (let offset = 0; offset < value.length; offset += chunkSize) {
    const chunk = value.subarray(offset, offset + chunkSize);
    for (const byte of chunk) {
      binary += String.fromCharCode(byte);
    }
  }

  return btoa(binary);
}

export function normalizeOptionalBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (!Array.isArray(value)) {
    return null;
  }

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

function toBase64WithoutPadding(value: string): string {
  return value.replace(/=+$/u, '');
}

export function decodeBase64ToBytes(value: string): Uint8Array | null {
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
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (
      toBase64WithoutPadding(encodeBytesToBase64(bytes)) !==
      toBase64WithoutPadding(normalized)
    ) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

export function readEnvelopeField(bytesValue: unknown): string | undefined {
  const parsedBytes = normalizeOptionalBytes(bytesValue);
  if (parsedBytes) {
    return encodeBytesToBase64(parsedBytes);
  }

  return undefined;
}

export function writeEnvelopeField(
  payload: Record<string, unknown>,
  input: {
    bytesKey: string;
    value: string;
    fieldName: string;
  }
): void {
  const decoded = decodeBase64ToBytes(input.value);
  if (!decoded) {
    throw new Error(`invalid protobuf payload field: ${input.fieldName}`);
  }

  payload[input.bytesKey] = decoded;
}
