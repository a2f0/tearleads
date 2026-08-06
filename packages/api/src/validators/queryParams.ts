import { validator } from "hono/validator";

interface QueryParamsSchema<Output> {
  safeParse(
    value: unknown,
  ):
    | { readonly data: Output; readonly success: true }
    | { readonly success: false };
}

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
  schema: QueryParamsSchema<Output>,
  errorMessage = "Invalid request",
) {
  return validator("query", (value, c) => {
    const result = schema.safeParse(firstQueryValues(value));
    if (!result.success) {
      return c.json({ error: errorMessage }, 400);
    }

    return result.data;
  });
}
