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

    const chunks: Uint8Array[] = [];
    const reader = request.body.getReader();
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return onError(context);
      }
      chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    context.req.raw = new Request(request, { body });
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
