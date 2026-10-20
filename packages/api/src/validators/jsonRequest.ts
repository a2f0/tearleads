import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
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

    // Use the runtime's native body consumption. A hand-rolled reader over
    // Bun's native request stream can intermittently segfault when a connection
    // resets. Browsers and chunked clients do not expose Content-Length here,
    // so the Worker's ingress bound (worker/requestBody.ts) applies the
    // pre-buffer ceiling, and the local Bun listener is loopback-only
    // (index.ts); this exact post-read check verifies declared lengths rather
    // than trusting them.
    const body = await context.req.arrayBuffer();
    if (body.byteLength > maxBytes) {
      return onTooLarge(context);
    }
    return next();
  };
}

export function jsonRequestValidator<Output>(schema: SafeParseSchema<Output>) {
  const validatedContexts = new WeakSet<Context>();
  const validate = validator("json", (value, c) => {
    validatedContexts.add(c);
    const result = schema.safeParse(value);
    if (!result.success) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return result.data;
  });
  const normalizeMalformedJson: typeof validate = async (context, next) => {
    // Hono reports any failed body read as malformed JSON. Reading the body
    // first (Hono reuses the cached bytes) lets a stream that overran the
    // ingress ceiling reach the error handler as 413 instead.
    if (context.req.raw.body !== null) {
      await context.req.arrayBuffer();
    }
    try {
      return await validate(context, next);
    } catch (error) {
      if (
        !validatedContexts.has(context) &&
        error instanceof HTTPException &&
        error.status === 400
      ) {
        return context.json({ error: "Invalid request" }, 400);
      }
      throw error;
    } finally {
      validatedContexts.delete(context);
    }
  };
  return normalizeMalformedJson;
}
