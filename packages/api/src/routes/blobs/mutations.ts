import {
  isBlobAttachmentBindRequest,
  isBlobAttachmentDetachRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  BlobMutationError,
  bindBlobAttachment,
  detachBlobAttachment,
} from "../../services/blobs/blobMutations";
import type { ApiServiceRuntime } from "../../services/runtime";

interface BlobMutationsRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

interface JsonValidationContext {
  json: (body: { readonly error: string }, status: 400) => Response;
}

function createRequestValidator<T>(isRequest: (value: unknown) => value is T) {
  return (value: unknown, c: JsonValidationContext): T | Response => {
    if (!isRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  };
}

const validateBlobAttachmentBindRequest = createRequestValidator(
  isBlobAttachmentBindRequest,
);

const validateBlobAttachmentDetachRequest = createRequestValidator(
  isBlobAttachmentDetachRequest,
);

export function createBlobMutationsRoute({
  requireAuth,
  runtime,
}: BlobMutationsRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.post(
    "/blobs/:blobId/attachment-bindings",
    requireAuth,
    validator("json", validateBlobAttachmentBindRequest),
    async (c) => {
      const blobId = c.req.param("blobId");
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
        if (error instanceof BlobMutationError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  route.post(
    "/blobs/:blobId/attachment-bindings/:bindingId/detach",
    requireAuth,
    validator("json", validateBlobAttachmentDetachRequest),
    async (c) => {
      const bindingId = c.req.param("bindingId");
      const blobId = c.req.param("blobId");
      const session = c.get("session");

      try {
        return c.json<BlobAttachmentDetachResponse>(
          await detachBlobAttachment(runtime, {
            bindingId,
            blobId,
            fingerprint: session.fingerprint,
            request: c.req.valid("json"),
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof BlobMutationError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
