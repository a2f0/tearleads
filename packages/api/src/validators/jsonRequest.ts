import type { Context, MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import type { SafeParseSchema } from "./schema";

interface RequestBodyLimitOptions {
  readonly maxBytes: number;
  readonly onLengthRequired: (context: Context) => Response | Promise<Response>;
  readonly onTooLarge: (context: Context) => Response | Promise<Response>;
}

export function requestBodyLimit({
  maxBytes,
  onLengthRequired,
  onTooLarge,
}: RequestBodyLimitOptions): MiddlewareHandler {
  return async (context, next) => {
    const request = context.req.raw;
    if (request.body === null) {
      return next();
    }

    const declaredLengthHeader = request.headers.get("Content-Length");
    const declaredLength = Number(declaredLengthHeader);
    if (
      declaredLengthHeader === null ||
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0
    ) {
      return onLengthRequired(context);
    }
    if (declaredLength > maxBytes) {
      return onTooLarge(context);
    }

    // Use Bun's native body consumption. A hand-rolled reader over the native
    // request stream can intermittently segfault behind the ingress tunnel.
    // Requiring Content-Length bounds Bun's allocation before this read; nginx
    // independently applies the same route-specific ceiling before proxying.
    const body = await context.req.arrayBuffer();
    if (body.byteLength > maxBytes) {
      return onTooLarge(context);
    }
    return next();
  };
}

export function jsonRequestValidator<Output>(schema: SafeParseSchema<Output>) {
  return validator("json", (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return result.data;
  });
}
