import { RequestBodyTooLargeError } from "../validators/requestBodyTooLarge";

/**
 * nginx rejected oversized bodies before Bun buffered them. The Worker keeps
 * that guarantee without buffering ahead of the routes: a declared length
 * above the ceiling is refused outright, and any other body is wrapped in a
 * stream that counts bytes as the route consumes it and fails the read once
 * the ceiling passes. Routes read bodies after their authentication, so an
 * unauthenticated client cannot make the isolate hold a body at all.
 */
export type BoundedRequest =
  | { readonly kind: "request"; readonly request: Request }
  | { readonly kind: "too-large" };

function declaredLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (header === null) {
    return null;
  }
  const length = Number(header);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

function limitBytes(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.error(new RequestBodyTooLargeError(maxBytes));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

export function boundRequestBody(
  request: Request,
  maxBytes: number,
): BoundedRequest {
  if (request.body === null) {
    return { kind: "request", request };
  }
  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) {
    return { kind: "too-large" };
  }
  // Bun's RequestInit type omits the standard duplex field a streamed body
  // needs; workerd ignores it.
  const init: RequestInit & { readonly duplex: "half" } = {
    body: request.body.pipeThrough(limitBytes(maxBytes)),
    duplex: "half",
  };
  return { kind: "request", request: new Request(request, init) };
}
