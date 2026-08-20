import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  hasNumberProperty,
  hasStringProperty,
} from "@tearleads/validators/util";
import { decodeCursor, encodeCursor } from "../../utils/cursor";
import { OrganizationManagerError } from "./errors";

const MAX_CURSOR = 9_223_372_036_854_775_807n;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/u;

interface OrganizationReadModelCursorPayload {
  readonly cursor: string;
  readonly organizationId: string;
  readonly version: 6;
}

function invalidCursor(): OrganizationManagerError {
  return new OrganizationManagerError(
    "Invalid organization read-model cursor",
    400,
  );
}

function parseOrganizationReadModelCursor(
  payload: unknown,
): OrganizationReadModelCursorPayload | undefined {
  if (
    !isPlainObject(payload) ||
    Object.keys(payload).length !== 3 ||
    !hasNumberProperty(payload, "version") ||
    payload.version !== 6 ||
    !hasStringProperty(payload, "organizationId") ||
    !hasStringProperty(payload, "cursor") ||
    !DECIMAL_PATTERN.test(payload.cursor)
  ) {
    return undefined;
  }
  return {
    cursor: payload.cursor,
    organizationId: payload.organizationId,
    version: 6,
  };
}

export function encodeOrganizationReadModelCursor(
  organizationId: string,
  cursor: bigint,
): string {
  const payload: OrganizationReadModelCursorPayload = {
    version: 6,
    organizationId,
    cursor: cursor.toString(),
  };
  return encodeCursor(payload);
}

export function decodeOrganizationReadModelCursor(
  value: string,
  organizationId: string,
): bigint {
  const payload = decodeCursor(
    value,
    parseOrganizationReadModelCursor,
    invalidCursor,
  );
  if (payload.organizationId !== organizationId) {
    throw invalidCursor();
  }

  const cursor = BigInt(payload.cursor);
  if (cursor > MAX_CURSOR) {
    throw invalidCursor();
  }

  return cursor;
}
