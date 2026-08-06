import { validator } from "hono/validator";

interface QueryParamsSchema<Output> {
  safeParse(
    value: unknown,
  ):
    | { readonly data: Output; readonly success: true }
    | { readonly success: false };
}

export function queryParamsValidator<Output>(
  schema: QueryParamsSchema<Output>,
  errorMessage = "Invalid request",
) {
  return validator("query", (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return c.json({ error: errorMessage }, 400);
    }

    return result.data;
  });
}
