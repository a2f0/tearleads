import {
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
} from "@tearleads/validators/response";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  BlobMutationError,
  bindBlobAttachment,
  detachBlobAttachment,
} from "../../services/blobs/blobMutations";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

interface BlobMutationsRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

// A blob failure carries at most the shared `container_unavailable` code;
// render it so a bind/detach refused for a deleted container is coded like the
// document and container mutations that share the path resolver (#2278 #4).
function respondToBlobMutationError(
  c: Context<SessionEnv>,
  error: unknown,
): Response {
  return respondToStatusError(
    c,
    error,
    BlobMutationError,
    error instanceof BlobMutationError && error.code
      ? { code: error.code, status: error.status }
      : undefined,
  );
}

export function createBlobMutationsRoute({
  requireAuth,
  runtime,
}: BlobMutationsRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    bindBlobAttachmentOperation.method,
    operationRoutePath(bindBlobAttachmentOperation),
    requireAuth,
    jsonRequestValidator(bindBlobAttachmentOperation.body),
    pathParamsValidator(
      bindBlobAttachmentOperation.params,
      "Invalid attachment route",
    ),
    async (c) => {
      const { blobId } = c.req.valid("param");
      const session = c.get("session");

      try {
        return c.json<BlobAttachmentBindResponse>(
          await bindBlobAttachment(runtime, {
            blobId,
            fingerprint: session.fingerprint,
            request: c.req.valid("json"),
            sessionId: session.id,
            userId: session.userId,
          }),
        );
      } catch (error) {
        return respondToBlobMutationError(c, error);
      }
    },
  );

  route.on(
    detachBlobAttachmentOperation.method,
    operationRoutePath(detachBlobAttachmentOperation),
    requireAuth,
    jsonRequestValidator(detachBlobAttachmentOperation.body),
    pathParamsValidator(
      detachBlobAttachmentOperation.params,
      "Invalid attachment route",
    ),
    async (c) => {
      const { bindingId, blobId } = c.req.valid("param");
      const session = c.get("session");

      try {
        return c.json<BlobAttachmentDetachResponse>(
          await detachBlobAttachment(runtime, {
            bindingId,
            blobId,
            fingerprint: session.fingerprint,
            request: c.req.valid("json"),
            sessionId: session.id,
            userId: session.userId,
          }),
        );
      } catch (error) {
        return respondToBlobMutationError(c, error);
      }
    },
  );

  return route;
}
