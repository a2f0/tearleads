import {
  type DocumentV2CreateRequest,
  type DocumentV2SyncRequest,
  isDocumentV2CreateRequest,
  isDocumentV2SyncRequest,
} from "@tearleads/validators/request";
import type {
  DocumentV2CreateResponse,
  DocumentV2SyncResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  createDocumentV2,
  DocumentV2MutationError,
  syncDocumentV2,
} from "../../services/documents/documentV2Mutations";
import type { ApiServiceRuntime } from "../../services/runtime";

interface DocumentV2MutationsRouteDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

interface JsonValidationContext {
  json: (body: { readonly error: string }, status: 400) => Response;
}

function validateDocumentV2CreateRequest(
  value: unknown,
  c: JsonValidationContext,
) {
  if (!isDocumentV2CreateRequest(value)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return value;
}

function validateDocumentV2SyncRequest(
  value: unknown,
  c: JsonValidationContext,
) {
  if (!isDocumentV2SyncRequest(value)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return value;
}

export function createDocumentV2MutationsRoute({
  publish,
  requireAuth,
  runtime,
}: DocumentV2MutationsRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.post(
    "/v2/documents",
    requireAuth,
    validator("json", validateDocumentV2CreateRequest),
    async (c) => {
      const session = c.get("session");

      try {
        return c.json<DocumentV2CreateResponse>(
          await createDocumentV2(runtime, {
            fingerprint: session.fingerprint,
            request: c.req.valid("json") as DocumentV2CreateRequest,
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof DocumentV2MutationError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  route.post(
    "/v2/documents/:documentId/sync",
    requireAuth,
    validator("json", validateDocumentV2SyncRequest),
    async (c) => {
      const documentId = c.req.param("documentId");
      const session = c.get("session");

      try {
        const result = await syncDocumentV2(runtime, {
          documentId,
          fingerprint: session.fingerprint,
          request: c.req.valid("json") as DocumentV2SyncRequest,
          userId: session.userId,
        });

        if (result.acceptedOutgoingUpdateIds.length > 0) {
          await publish({
            type: "document_update_created",
            documentId,
            updateIds: result.acceptedOutgoingUpdateIds,
          });
        }

        return c.json<DocumentV2SyncResponse>(result);
      } catch (error) {
        if (error instanceof DocumentV2MutationError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
