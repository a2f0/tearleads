import {
  isBlobV2AttachmentBindRequest,
  isBlobV2AttachmentDetachRequest,
} from "@tearleads/validators/request";
import type {
  BlobV2AttachmentBindResponse,
  BlobV2AttachmentDetachResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  BlobV2MutationError,
  bindBlobAttachmentV2,
  detachBlobAttachmentV2,
} from "../../services/blobs/blobV2Mutations";
import type { ApiServiceRuntime } from "../../services/runtime";

interface BlobV2MutationsRouteDeps {
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

const validateBlobV2AttachmentBindRequest = createRequestValidator(
  isBlobV2AttachmentBindRequest,
);

const validateBlobV2AttachmentDetachRequest = createRequestValidator(
  isBlobV2AttachmentDetachRequest,
);

export function createBlobV2MutationsRoute({
  requireAuth,
  runtime,
}: BlobV2MutationsRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.post(
    "/v2/blobs/:blobId/attachment-bindings",
    requireAuth,
    validator("json", validateBlobV2AttachmentBindRequest),
    async (c) => {
      const blobId = c.req.param("blobId");
      const session = c.get("session");

      try {
        return c.json<BlobV2AttachmentBindResponse>(
          await bindBlobAttachmentV2(runtime, {
            blobId,
            fingerprint: session.fingerprint,
            request: c.req.valid("json"),
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof BlobV2MutationError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  route.post(
    "/v2/blobs/:blobId/attachment-bindings/:bindingId/detach",
    requireAuth,
    validator("json", validateBlobV2AttachmentDetachRequest),
    async (c) => {
      const bindingId = c.req.param("bindingId");
      const blobId = c.req.param("blobId");
      const session = c.get("session");

      try {
        return c.json<BlobV2AttachmentDetachResponse>(
          await detachBlobAttachmentV2(runtime, {
            bindingId,
            blobId,
            fingerprint: session.fingerprint,
            request: c.req.valid("json"),
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof BlobV2MutationError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
