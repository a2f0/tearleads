import { validator } from "hono/validator";
import type { SafeParseSchema } from "./schema";

export function pathParamsValidator<Output>(
  schema: SafeParseSchema<Output>,
  errorMessage: string | ((value: unknown) => string) = "Invalid request",
) {
  return validator("param", (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return c.json(
        {
          error:
            typeof errorMessage === "string"
              ? errorMessage
              : errorMessage(value),
        },
        400,
      );
    }

    return result.data;
  });
}
