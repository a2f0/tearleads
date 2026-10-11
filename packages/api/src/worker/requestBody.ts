import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
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

/**
 * Ingress ceilings per route, as nginx applied them. Authenticated routes
 * keep the route ceiling: blob parts, document payloads, and container
 * rotations carry keyrings and baselines that their validators bound. Document
 * sync has its own smaller contract, enforced here before the route buffers
 * anything. The surface a client reaches without a session (registration and
 * login, the billing webhooks, and the health probe) only ever carries small
 * JSON, so its ceiling keeps an unauthenticated request from making the
 * isolate buffer or parse more than that before the route refuses it.
 */
export const MAX_UNAUTHENTICATED_REQUEST_BYTES = 2 * 1024 * 1024;

const UNAUTHENTICATED_PATHS = [/^\/$/, /^\/auth(\/|$)/, /^\/billing(\/|$)/];
// Matched on the raw path, as nginx did, so an encoded separator cannot pick
// a larger ceiling than the route it reaches.
const DOCUMENT_SYNC_PATH = /^\/documents\/[^/]+\/sync$/;

export function requestBodyCeiling(
  pathname: string,
  routeCeiling: number,
): number {
  if (UNAUTHENTICATED_PATHS.some((pattern) => pattern.test(pathname))) {
    return MAX_UNAUTHENTICATED_REQUEST_BYTES;
  }
  if (DOCUMENT_SYNC_PATH.test(pathname)) {
    return Math.min(MAX_DOCUMENT_SYNC_REQUEST_BYTES, routeCeiling);
  }
  return routeCeiling;
}

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
