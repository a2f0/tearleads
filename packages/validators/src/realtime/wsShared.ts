import { z } from "zod";

export const MAX_WS_DECLARATION_ID_LENGTH = 128;

/**
 * Lifetime of a single-use websocket upgrade ticket. `POST /auth/verify`
 * returns one for the first connect after login; later connects mint their own
 * through `POST /auth/ws-ticket`.
 */
export const WS_TICKET_TTL_SECONDS = 60;

export const wsDeclarationIdSchema = z
  .string()
  .min(1)
  .max(MAX_WS_DECLARATION_ID_LENGTH);

export function parseWsJson<Schema extends z.ZodType>(
  schema: Schema,
  rawMessage: string,
): z.output<Schema> | null {
  let value: unknown;
  try {
    value = JSON.parse(rawMessage);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
