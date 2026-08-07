import { validator } from "hono/validator";
import type { SafeParseSchema } from "./schema";

export function jsonRequestValidator<Output>(schema: SafeParseSchema<Output>) {
  return validator("json", (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return result.data;
  });
}
