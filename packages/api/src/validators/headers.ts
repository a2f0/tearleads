import { validator } from "hono/validator";

interface HeadersSchema<Output> {
  safeParse(
    value: unknown,
  ):
    | { readonly data: Output; readonly success: true }
    | { readonly success: false };
}

export function headersValidator<Output>(schema: HeadersSchema<Output>) {
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
