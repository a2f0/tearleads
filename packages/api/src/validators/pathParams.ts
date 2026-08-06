import { validator } from "hono/validator";

interface PathParamsSchema<Output> {
  safeParse(
    value: unknown,
  ):
    | { readonly data: Output; readonly success: true }
    | { readonly success: false };
}

export function pathParamsValidator<Output>(
  schema: PathParamsSchema<Output>,
  errorMessage = "Invalid request",
) {
  return validator("param", (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return c.json({ error: errorMessage }, 400);
    }

    return result.data;
  });
}
