import {
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
} from "@symcrypt/validators/response";
import type { MiddlewareHandler } from "hono";
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
        return respondToStatusError(c, error, BlobMutationError);
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
        return respondToStatusError(c, error, BlobMutationError);
      }
    },
  );

  return route;
}
