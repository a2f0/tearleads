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

/**
 * Bytes this isolate may hold for requests at once: their bodies and, for
 * document sync, the response page a pull materializes. The per-request
 * ceilings bound one request; an isolate serving several large requests at
 * the same time still has one 128 MB heap, so each is admitted against a
 * shared budget and one that would overrun it is told to retry. Two full
 * sync pulls, or three part uploads, fit at once.
 */
const BODY_ADMISSION_BYTES = 96 * 1024 * 1024;

export interface BodyAdmission {
  /** Reserve the bytes a request may buffer, or refuse when over budget. */
  readonly admit: (bytes: number) => boolean;
  readonly release: (bytes: number) => void;
  readonly inFlight: () => number;
}

export function createBodyAdmission(
  capacity = BODY_ADMISSION_BYTES,
): BodyAdmission {
  let held = 0;
  return {
    admit: (bytes) => {
      if (held + bytes > capacity) {
        return false;
      }
      held += bytes;
      return true;
    },
    release: (bytes) => {
      held -= bytes;
    },
    inFlight: () => held,
  };
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
  const page = DOCUMENT_SYNC_PATH.test(decodedPath(pathname))
    ? MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES
    : 0;
  if (request.body === null) {
    return page;
  }
  const declared = declaredLength(request);
  return (declared === null ? ceiling : Math.min(declared, ceiling)) + page;
}
