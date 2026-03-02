function parseJsonObject<T>(rawJson: string): T {
  return JSON.parse(rawJson);
}

export function createConnectJsonPostInit(body: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export function parseConnectJsonString<T>(json: unknown): T {
  if (typeof json !== 'string') {
    return parseJsonObject('{}');
  }
  const trimmed = json.trim();
  if (trimmed.length === 0) {
    return parseJsonObject('{}');
  }
  return parseJsonObject(trimmed);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseConnectJsonEnvelopeBody(body: unknown): unknown {
  if (!isPlainRecord(body) || typeof body['json'] !== 'string') {
    return body;
  }

  const rawJson = body['json'].trim();
  if (rawJson.length === 0) {
    return {};
  }

  try {
    return parseJsonObject(rawJson);
  } catch {
    throw new Error('transport returned invalid connect json envelope');
  }
}
