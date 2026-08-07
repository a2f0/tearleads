import { validator } from "hono/validator";
import type { SafeParseSchema } from "./schema";

type QueryParamsErrorMessage =
  | string
  | ((schemaMessage: string | undefined) => string);

function firstQueryValues(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      Array.isArray(item) ? item[0] : item,
    ]),
  );
}

export function queryParamsValidator<Output>(
  schema: SafeParseSchema<Output>,
  errorMessage: QueryParamsErrorMessage = "Invalid request",
) {
  return validator("query", (value, c) => {
    const result = schema.safeParse(firstQueryValues(value));
    if (!result.success) {
      const message =
        typeof errorMessage === "string"
          ? errorMessage
          : errorMessage(result.error?.issues?.[0]?.message);
      return c.json({ error: message }, 400);
    }

    return result.data;
  });
}
