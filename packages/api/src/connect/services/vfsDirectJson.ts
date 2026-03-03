import { Code, ConnectError } from '@connectrpc/connect';

export function parseJsonBody(json: string): unknown {
  const normalized = json.trim().length > 0 ? json : '{}';

  try {
    return JSON.parse(normalized);
  } catch {
    throw new ConnectError('Invalid JSON body', Code.InvalidArgument);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function encoded(value: string): string {
  return encodeURIComponent(value);
}
