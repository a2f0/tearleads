import { validator } from "hono/validator";

interface JsonRequestSchema<Output> {
  safeParse(
    value: unknown,
  ):
    | { readonly data: Output; readonly success: true }
    | { readonly success: false };
}

export function jsonRequestValidator<Output>(
  schema: JsonRequestSchema<Output>,
) {
  return validator("json", (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return result.data;
  });
}
