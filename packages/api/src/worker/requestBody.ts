import {
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES,
} from "@tearleads/validators/util";
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
const DOCUMENT_SYNC_PATH = /^\/documents\/[^/]+\/sync$/;

function ceilingForPath(pathname: string, routeCeiling: number): number {
  if (UNAUTHENTICATED_PATHS.some((pattern) => pattern.test(pathname))) {
    return MAX_UNAUTHENTICATED_REQUEST_BYTES;
  }
  if (DOCUMENT_SYNC_PATH.test(pathname)) {
    return Math.min(MAX_DOCUMENT_SYNC_REQUEST_BYTES, routeCeiling);
  }
  return routeCeiling;
}

// Decoded the way the router does it: escape by escape, keeping any run that
// does not decode, so one bad escape cannot hide a decodable route name.
function decodedPath(pathname: string): string {
  return pathname.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * The router matches the decoded path, so `/%61uth/register` is the
 * registration route; an encoded separator, on the other hand, could spell a
 * larger route than the one reached. Both spellings are judged and the
 * smaller ceiling wins.
 */
export function requestBodyCeiling(
  pathname: string,
  routeCeiling: number,
): number {
  return Math.min(
    ceilingForPath(pathname, routeCeiling),
    ceilingForPath(decodedPath(pathname), routeCeiling),
  );
}

function declaredLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (header === null) {
    return null;
  }
  const length = Number(header);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

/** Check without wrapping or reading the body, before waiting for admission. */
export function declaredBodyTooLarge(
  request: Request,
  maxBytes: number,
): boolean {
  const declared = declaredLength(request);
  return request.body !== null && declared !== null && declared > maxBytes;
}

const trippedLimiters = new WeakMap<Request, () => boolean>();

/**
 * Whether the request's body ran past its ceiling. The runtime may surface a
 * failed body stream to the route as its own connection error rather than
 * the limiter's, so the entry asks this after the route answers.
 */
export function requestBodyOverflowed(request: Request): boolean {
  return trippedLimiters.get(request)?.() ?? false;
}

/**
 * Counts the body as the route reads it; past the ceiling the route's read
 * fails and the connection is torn down, so nothing past the ceiling is ever
 * retained and a flooding client is cut off rather than drained.
 */
function limitBytes(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
): {
  readonly stream: ReadableStream<Uint8Array>;
  readonly tripped: () => boolean;
} {
  let total = 0;
  let tripped = false;
  const stream = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          tripped = true;
          controller.error(new RequestBodyTooLargeError(maxBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return { stream, tripped: () => tripped };
}

export function boundRequestBody(
  request: Request,
  maxBytes: number,
): BoundedRequest {
  if (request.body === null) {
    return { kind: "request", request };
  }
  if (declaredBodyTooLarge(request, maxBytes)) {
    return { kind: "too-large" };
  }
  // Bun's RequestInit type omits the standard duplex field a streamed body
  // needs; workerd ignores it.
  const limiter = limitBytes(request.body, maxBytes);
  const init: RequestInit & { readonly duplex: "half" } = {
    body: limiter.stream,
    duplex: "half",
  };
  const bounded = new Request(request, init);
  trippedLimiters.set(bounded, limiter.tripped);
  return { kind: "request", request: bounded };
}

/**
 * The most a request can make the isolate hold: its declared body length,
 * else its ceiling, plus the response page a document sync pull may build.
 */
export function expectedRequestBytes(
  request: Request,
  pathname: string,
  ceiling: number,
): number {
  const page =
    request.method === "POST" && DOCUMENT_SYNC_PATH.test(decodedPath(pathname))
      ? MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES
      : 0;
  if (request.body === null) {
    return page;
  }
  const declared = declaredLength(request);
  return (declared === null ? ceiling : Math.min(declared, ceiling)) + page;
}

/**
 * Keeps a request's reservation until its response has drained: a slow
 * reader holds the page the route built for as long as the body streams.
 * `release` runs exactly once, on completion, cancellation, or a bodiless
 * response.
 */
export function retainUntilDrained(
  response: Response,
  release: () => void,
): Response {
  let released = false;
  const releaseOnce = () => {
    if (!released) {
      released = true;
      release();
    }
  };
  if (response.body === null) {
    releaseOnce();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          releaseOnce();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        releaseOnce();
        controller.error(error);
      }
    },
    cancel(reason) {
      releaseOnce();
      return reader.cancel(reason);
    },
  });
  return new Response(body, response);
}
