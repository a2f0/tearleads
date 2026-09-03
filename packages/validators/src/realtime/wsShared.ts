import { z } from "zod";

export const MAX_WS_DECLARATION_ID_LENGTH = 128;

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
