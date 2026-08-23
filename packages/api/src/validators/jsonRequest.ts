import type { Context, MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import type { SafeParseSchema } from "./schema";

interface RequestBodyLimitOptions {
  readonly maxBytes: number;
  readonly onTooLarge: (context: Context) => Response | Promise<Response>;
}

export function requestBodyLimit({
  maxBytes,
  onTooLarge,
}: RequestBodyLimitOptions): MiddlewareHandler {
  return async (context, next) => {
    const request = context.req.raw;
    if (request.body === null) {
      return next();
    }

    const declaredLengthHeader = request.headers.get("Content-Length");
    if (declaredLengthHeader !== null) {
      const declaredLength = Number(declaredLengthHeader);
      if (
        Number.isSafeInteger(declaredLength) &&
        declaredLength >= 0 &&
        declaredLength > maxBytes
      ) {
        return onTooLarge(context);
      }
    }

    // Use Bun's native body consumption. A hand-rolled reader over the native
    // request stream can intermittently segfault behind the ingress tunnel.
    // Browsers and chunked clients do not expose Content-Length here, so nginx
    // applies the pre-buffer ceiling. The Bun listener is enforced loopback-only
    // in index.ts; this exact post-read check protects trusted direct diagnostics
    // and verifies declared lengths rather than trusting them.
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
