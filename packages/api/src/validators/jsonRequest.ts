import type { Context, MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import type { SafeParseSchema } from "./schema";

export function requestBodyLimit(
  maxBytes: number,
  onError: (context: Context) => Response | Promise<Response>,
): MiddlewareHandler {
  return async (context, next) => {
    const request = context.req.raw;
    if (request.body === null) {
      return next();
    }

    const declaredLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return onError(context);
    }

    // Use Bun's native body consumption. A hand-rolled reader over the native
    // request stream can intermittently segfault behind the ingress tunnel.
    // Bun's server ceiling bounds direct requests, while nginx applies this
    // route's tighter JSON ceiling before proxying in deployed environments.
    const body = await context.req.arrayBuffer();
    if (body.byteLength > maxBytes) {
      return onError(context);
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
