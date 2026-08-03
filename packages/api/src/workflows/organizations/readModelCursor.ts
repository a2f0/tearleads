import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  hasNumberProperty,
  hasStringProperty,
} from "@tearleads/validators/util";
import { OrganizationManagerError } from "./errors";

const MAX_CURSOR = 9_223_372_036_854_775_807n;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/u;

interface OrganizationReadModelCursorPayload {
  readonly cursor: string;
  readonly organizationId: string;
  readonly version: 5;
}

function invalidCursor(): OrganizationManagerError {
  return new OrganizationManagerError(
    "Invalid organization read-model cursor",
    400,
  );
}

export function encodeOrganizationReadModelCursor(
  organizationId: string,
  cursor: bigint,
): string {
  const payload: OrganizationReadModelCursorPayload = {
    version: 5,
    organizationId,
    cursor: cursor.toString(),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeOrganizationReadModelCursor(
  value: string,
  organizationId: string,
): bigint {
  if (value.length === 0 || value.length > 512 || !CURSOR_PATTERN.test(value)) {
    throw invalidCursor();
  }

  let decoded: string;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) {
      throw invalidCursor();
    }
    decoded = bytes.toString("utf8");
  } catch {
    throw invalidCursor();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    throw invalidCursor();
  }
  if (
    !isPlainObject(payload) ||
    Object.keys(payload).length !== 3 ||
    !hasNumberProperty(payload, "version") ||
    payload.version !== 5 ||
    !hasStringProperty(payload, "organizationId") ||
    payload.organizationId !== organizationId ||
    !hasStringProperty(payload, "cursor") ||
    !DECIMAL_PATTERN.test(payload.cursor)
  ) {
    throw invalidCursor();
  }

  const cursor = BigInt(payload.cursor);
  if (cursor > MAX_CURSOR) {
    throw invalidCursor();
  }

  return cursor;
}
