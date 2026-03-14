export interface ParsedApiErrorResponse {
  message: string;
  code: string | null;
  requestedCursor: string | null;
  oldestAvailableCursor: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseErrorMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['error'] === 'string') {
    const normalized = body['error'].trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  if (isRecord(body) && typeof body['message'] === 'string') {
    const normalized = body['message'].trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return `request failed with status ${status}`;
}

export function parseApiErrorResponse(
  status: number,
  body: unknown
): ParsedApiErrorResponse {
  const message = parseErrorMessage(status, body);
  if (!isRecord(body)) {
    return {
      message,
      code: null,
      requestedCursor: null,
      oldestAvailableCursor: null
    };
  }

  const codeRaw = body['code'];
  const requestedCursorRaw = body['requestedCursor'];
  const oldestAvailableCursorRaw = body['oldestAvailableCursor'];

  return {
    message,
    code:
      typeof codeRaw === 'string' && codeRaw.trim().length > 0
        ? codeRaw.trim()
        : null,
    requestedCursor:
      typeof requestedCursorRaw === 'string' &&
      requestedCursorRaw.trim().length > 0
        ? requestedCursorRaw.trim()
        : null,
    oldestAvailableCursor:
      typeof oldestAvailableCursorRaw === 'string' &&
      oldestAvailableCursorRaw.trim().length > 0
        ? oldestAvailableCursorRaw.trim()
        : null
  };
}
