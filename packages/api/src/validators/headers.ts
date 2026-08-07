import { validator } from "hono/validator";
import type { SafeParseSchema } from "./schema";

export function headersValidator<Output>(schema: SafeParseSchema<Output>) {
  return validator("header", (value, c) => {
    const normalizedHeaders = Object.fromEntries(
      Object.entries(value).map(([name, headerValue]) => [
        name.toLowerCase(),
        headerValue,
      ]),
    );
    const result = schema.safeParse(normalizedHeaders);
    if (!result.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return result.data;
  });
}
