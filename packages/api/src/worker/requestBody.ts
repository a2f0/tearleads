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
 * Ingress ceilings per route, as nginx applied them. Only blob parts and
 * document payloads (initial content, rotation baselines, sync batches, each
 * already bounded by its own validator) are large. Every other route carries
 * small JSON, so a client that has not authenticated cannot make the isolate
 * buffer or parse more than this before the route refuses it.
 */
export const MAX_JSON_REQUEST_BYTES = 2 * 1024 * 1024;

const BLOB_PART_PATH =
  /^\/blobs\/stages\/multipart\/[^/]+\/parts\/[^/]+\/bytes$/;
const DOCUMENT_PAYLOAD_PATHS = [
  /^\/documents(\/|$)/,
  /^\/containers\/with-metadata-document$/,
];

export function requestBodyCeiling(
  pathname: string,
  partCeiling: number,
): number {
  if (BLOB_PART_PATH.test(pathname)) {
    return partCeiling;
  }
  if (DOCUMENT_PAYLOAD_PATHS.some((pattern) => pattern.test(pathname))) {
    return partCeiling;
  }
  return MAX_JSON_REQUEST_BYTES;
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
