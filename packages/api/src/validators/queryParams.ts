import { validator } from "hono/validator";

interface QueryParamsSchema<Output> {
  safeParse(value: unknown):
    | { readonly data: Output; readonly success: true }
    | {
        readonly error?: {
          readonly issues?: readonly { readonly message: string }[];
        };
        readonly success: false;
      };
}

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
  schema: QueryParamsSchema<Output>,
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
