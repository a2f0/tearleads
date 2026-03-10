import { parseConnectJsonEnvelopeBody } from '@tearleads/shared';

export interface ConnectRouteMapping {
  path: string;
  body: Record<string, unknown>;
  unwrapJsonEnvelope: boolean;
  successStatus?: number;
  legacyDefaults?: Record<string, unknown>;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mapLegacyPathToConnect(
  _path: string,
  _init: RequestInit | undefined
): ConnectRouteMapping | null {
  return null;
}

export function mergeHeaders(
  authToken: string,
  extraHeaders?: RequestInit['headers'],
  organizationId?: string
): Headers {
  const merged = new Headers({ Authorization: `Bearer ${authToken}` });
  if (organizationId) {
    merged.set('X-Organization-Id', organizationId);
  }
  if (extraHeaders) {
    const provided = new Headers(extraHeaders);
    for (const [key, value] of provided.entries()) {
      merged.set(key, value);
    }
  }
  return merged;
}

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function extractErrorMessage(rawText: string): string {
  if (rawText.trim().length === 0) {
    return 'Request failed';
  }

  try {
    const parsed = parseJson<unknown>(rawText);
    if (isRecord(parsed) && typeof parsed['error'] === 'string') {
      return parsed['error'];
    }
    if (isRecord(parsed) && typeof parsed['message'] === 'string') {
      return parsed['message'];
    }
  } catch {
    // Keep fallback text path.
  }

  return rawText;
}

export async function adaptConnectResponse(
  response: Response,
  mapping: ConnectRouteMapping
): Promise<Response> {
  const rawText = await response.text();
  if (!response.ok) {
    return createJsonResponse(response.status, {
      error: extractErrorMessage(rawText)
    });
  }

  let normalizedBody: unknown = {};
  if (rawText.trim().length > 0) {
    const parsedBody = parseJson<unknown>(rawText);
    normalizedBody = mapping.unwrapJsonEnvelope
      ? parseConnectJsonEnvelopeBody(parsedBody)
      : parsedBody;
  }
  if (mapping.legacyDefaults && isRecord(normalizedBody)) {
    normalizedBody = { ...mapping.legacyDefaults, ...normalizedBody };
  }

  return createJsonResponse(
    mapping.successStatus ?? response.status,
    normalizedBody
  );
}

export function resolveDirectApiPath(path: string): string {
  if (path.startsWith('/v1/')) {
    return path;
  }
  if (path.startsWith('/connect/')) {
    return `/v1${path}`;
  }
  return `/v1${path}`;
}
