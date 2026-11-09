import { z } from "zod";
import { isPlainObject } from "./isPlainObject";

/**
 * The organization read-model cursor contract shared by the server, which
 * encodes and authoritatively decodes it, and clients, which only compare a
 * realtime hint's cursor with the cursor they already applied.
 *
 * The wire form is base64url JSON naming the protocol version, the
 * organization, and the decimal position of the organization's cursor head.
 * Positions are monotone per organization; the encoded strings are not
 * ordered.
 */
export const ORGANIZATION_READ_MODEL_CURSOR_VERSION = 6;

/** The cursor head is a Postgres bigint. */
export const MAX_ORGANIZATION_READ_MODEL_CURSOR_POSITION =
  9_223_372_036_854_775_807n;

const MAX_ENCODED_CURSOR_LENGTH = 512;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/u;

export const OrganizationReadModelEncodedCursorSchema = z
  .string()
  .min(1)
  .max(MAX_ENCODED_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/u);

// Exactly these three keys: a cursor from another version never decodes.
export const OrganizationReadModelCursorPayloadSchema = z
  .custom<Record<string, unknown>>(isPlainObject)
  .pipe(
    z.strictObject({
      version: z.literal(ORGANIZATION_READ_MODEL_CURSOR_VERSION),
      organizationId: z.string(),
      cursor: z.string().regex(DECIMAL_PATTERN),
    }),
  );

export type OrganizationReadModelCursorPayload = z.infer<
  typeof OrganizationReadModelCursorPayloadSchema
>;

function decodeBase64UrlJson(value: string): unknown {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * The monotone position an encoded cursor names for `organizationId`, or null
 * when the value is not a valid version 6 cursor for that organization.
 * Callers treat null as unknown and fall back to an authoritative read.
 */
export function organizationReadModelCursorPosition(
  value: string,
  organizationId: string,
): bigint | null {
  if (!OrganizationReadModelEncodedCursorSchema.safeParse(value).success) {
    return null;
  }
  const payload = OrganizationReadModelCursorPayloadSchema.safeParse(
    decodeBase64UrlJson(value),
  ).data;
  if (!payload || payload.organizationId !== organizationId) {
    return null;
  }
  const position = BigInt(payload.cursor);
  return position > MAX_ORGANIZATION_READ_MODEL_CURSOR_POSITION
    ? null
    : position;
}
