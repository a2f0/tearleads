import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../../utils/cursor";
import { OrganizationReadModelCursorError } from "./errors";

const MAX_CURSOR = 9_223_372_036_854_775_807n;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/u;

interface OrganizationReadModelCursorPayload {
  readonly cursor: string;
  readonly organizationId: string;
  readonly version: 6;
}

function invalidCursor(): OrganizationReadModelCursorError {
  return new OrganizationReadModelCursorError(
    "Invalid organization read-model cursor",
  );
}

// Exactly these three keys: a cursor from another version never decodes.
const organizationReadModelCursorSchema = z
  .custom<Record<string, unknown>>(isPlainObject)
  .pipe(
    z.strictObject({
      version: z.literal(6),
      organizationId: z.string(),
      cursor: z.string().regex(DECIMAL_PATTERN),
    }),
  );

function parseOrganizationReadModelCursor(
  payload: unknown,
): OrganizationReadModelCursorPayload | undefined {
  return organizationReadModelCursorSchema.safeParse(payload).data;
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
