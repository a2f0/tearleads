import {
  MAX_ORGANIZATION_READ_MODEL_CURSOR_POSITION,
  ORGANIZATION_READ_MODEL_CURSOR_VERSION,
  type OrganizationReadModelCursorPayload,
  OrganizationReadModelCursorPayloadSchema,
} from "@tearleads/validators/organizationReadModelCursor";
import { decodeCursor, encodeCursor } from "../../utils/cursor";
import { OrganizationReadModelCursorError } from "./errors";

function invalidCursor(): OrganizationReadModelCursorError {
  return new OrganizationReadModelCursorError(
    "Invalid organization read-model cursor",
  );
}

export function encodeOrganizationReadModelCursor(
  organizationId: string,
  cursor: bigint,
): string {
  const payload: OrganizationReadModelCursorPayload = {
    version: ORGANIZATION_READ_MODEL_CURSOR_VERSION,
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
    (candidate) =>
      OrganizationReadModelCursorPayloadSchema.safeParse(candidate).data,
    invalidCursor,
  );
  if (payload.organizationId !== organizationId) {
    throw invalidCursor();
  }

  const cursor = BigInt(payload.cursor);
  if (cursor > MAX_ORGANIZATION_READ_MODEL_CURSOR_POSITION) {
    throw invalidCursor();
  }

  return cursor;
}
