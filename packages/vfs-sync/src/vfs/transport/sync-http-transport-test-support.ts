import type protobuf from 'protobufjs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getHeaderValue(
  init: unknown,
  headerName: string
): string | null {
  if (!isRecord(init)) {
    return null;
  }

  const rawHeaders = init['headers'];
  if (rawHeaders instanceof Headers) {
    return rawHeaders.get(headerName);
  }

  if (Array.isArray(rawHeaders)) {
    const normalizedName = headerName.toLowerCase();
    for (const entry of rawHeaders) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }

      const candidateName = entry[0];
      const candidateValue = entry[1];
      if (
        typeof candidateName === 'string' &&
        typeof candidateValue === 'string' &&
        candidateName.toLowerCase() === normalizedName
      ) {
        return candidateValue;
      }
    }

    return null;
  }

  if (!isRecord(rawHeaders)) {
    return null;
  }

  for (const [key, value] of Object.entries(rawHeaders)) {
    if (
      key.toLowerCase() === headerName.toLowerCase() &&
      typeof value === 'string'
    ) {
      return value;
    }
  }

  return null;
}

export function getJsonBody(init: unknown): unknown {
  if (!isRecord(init)) {
    return null;
  }

  const rawBody = init['body'];
  if (typeof rawBody !== 'string') {
    return null;
  }

  return JSON.parse(rawBody);
}

export function getProtobufBody(init: unknown, type: protobuf.Type): unknown {
  if (!isRecord(init)) {
    return null;
  }

  const rawBody = init['body'];
  if (!(rawBody instanceof Uint8Array)) {
    return null;
  }

  return type.decode(rawBody).toJSON();
}
