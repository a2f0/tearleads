import { Buffer } from "node:buffer";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MAX_CURSOR_LENGTH = 512;

export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor<T>(
  value: string,
  parsePayload: (payload: unknown) => T | undefined,
  invalidCursor: () => Error,
): T {
  try {
    if (
      value.length === 0 ||
      value.length > MAX_CURSOR_LENGTH ||
      !CURSOR_PATTERN.test(value)
    ) {
      throw new Error("Invalid cursor encoding");
    }
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) {
      throw new Error("Non-canonical cursor encoding");
    }
    const payload: unknown = JSON.parse(bytes.toString("utf8"));
    const parsed = parsePayload(payload);
    if (parsed === undefined) {
      throw new Error("Invalid cursor payload");
    }
    return parsed;
  } catch {
    throw invalidCursor();
  }
}
