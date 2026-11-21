import {
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import {
  BLOB_MUTATION_ERROR_CODES,
  type BlobAttachmentBindFailureResponse,
  type BlobAttachmentBindResponse,
  type BlobAttachmentDetachResponse,
  type BlobMutationErrorCode,
  type BlobMutationFailureResponse,
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

// A blob failure carries at most one code: the shared `container_unavailable`,
// so a bind/detach refused for a deleted container is coded like the document
// and container mutations that share the path resolver (#2278 #4), or a bind's
// `attachment_document_changed`, which the uploader retries after a pull.
// Each route narrows the code to its own response schema.
function respondToBlobMutationError<Code extends BlobMutationErrorCode>(
  c: Context<SessionEnv>,
  error: unknown,
  responseCode: (code: BlobMutationErrorCode) => Code | undefined,
): Response {
  const code =
    error instanceof BlobMutationError && error.code
      ? responseCode(error.code)
      : undefined;
  return respondToStatusError(
    c,
    error,
    BlobMutationError,
    code && error instanceof BlobMutationError
      ? { code, status: error.status }
      : undefined,
  );
}

function bindFailureCode(
  code: BlobMutationErrorCode,
): NonNullable<BlobAttachmentBindFailureResponse["code"]> {
  return code;
}

function detachFailureCode(
  code: BlobMutationErrorCode,
): NonNullable<BlobMutationFailureResponse["code"]> | undefined {
  return code === BLOB_MUTATION_ERROR_CODES.containerUnavailable
    ? code
    : undefined;
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
        return respondToBlobMutationError(c, error, bindFailureCode);
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
        return respondToBlobMutationError(c, error, detachFailureCode);
      }
    },
  );

  return route;
}
