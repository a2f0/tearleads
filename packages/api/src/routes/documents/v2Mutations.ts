import {
  type DocumentV2CreateRequest,
  type DocumentV2LinkSetMutationRequest,
  type DocumentV2SyncRequest,
  isDocumentV2CreateRequest,
  isDocumentV2LinkSetMutationRequest,
  isDocumentV2SyncRequest,
} from "@tearleads/validators/request";
import type {
  DocumentV2CreateResponse,
  DocumentV2LinkSetMutationResponse,
  DocumentV2SyncResponse,
} from "@tearleads/validators/response";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  createDocumentV2,
  DocumentV2MutationError,
  mutateDocumentV2LinkSet,
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

type DocumentV2RouteContext = Context<SessionEnv>;
type DocumentV2LinkSetEventType = "document.link" | "document.unlink";
type JsonValidatedRequest = {
  valid: (target: "json") => unknown;
};

function validateDocumentV2CreateRequest(
  value: unknown,
  c: JsonValidationContext,
) {
  if (!isDocumentV2CreateRequest(value)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return value;
}

function validateDocumentV2LinkSetMutationRequest(
  value: unknown,
  c: JsonValidationContext,
) {
  if (!isDocumentV2LinkSetMutationRequest(value)) {
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

function handleDocumentV2MutationError(error: unknown) {
  if (error instanceof DocumentV2MutationError) {
    return { error: error.message, status: error.status };
  }

  throw error;
}

function readValidatedJson(c: DocumentV2RouteContext): unknown {
  return (c.req as unknown as JsonValidatedRequest).valid("json");
}

async function respondWithDocumentV2Create(
  c: DocumentV2RouteContext,
  runtime: ApiServiceRuntime,
) {
  const session = c.get("session");

  try {
    return c.json<DocumentV2CreateResponse>(
      await createDocumentV2(runtime, {
        fingerprint: session.fingerprint,
        request: readValidatedJson(c) as DocumentV2CreateRequest,
        userId: session.userId,
      }),
    );
  } catch (error) {
    const result = handleDocumentV2MutationError(error);
    return c.json({ error: result.error }, result.status);
  }
}

async function respondWithDocumentV2LinkSetMutation(
  c: DocumentV2RouteContext,
  runtime: ApiServiceRuntime,
  eventType: DocumentV2LinkSetEventType,
) {
  const documentId = c.req.param("documentId");
  const session = c.get("session");

  try {
    return c.json<DocumentV2LinkSetMutationResponse>(
      await mutateDocumentV2LinkSet(runtime, {
        documentId,
        eventType,
        fingerprint: session.fingerprint,
        request: readValidatedJson(c) as DocumentV2LinkSetMutationRequest,
        userId: session.userId,
      }),
    );
  } catch (error) {
    const result = handleDocumentV2MutationError(error);
    return c.json({ error: result.error }, result.status);
  }
}

async function respondWithDocumentV2Sync(
  c: DocumentV2RouteContext,
  input: {
    readonly publish: (event: Record<string, unknown>) => Promise<void>;
    readonly runtime: ApiServiceRuntime;
  },
) {
  const documentId = c.req.param("documentId");
  const session = c.get("session");

  try {
    const result = await syncDocumentV2(input.runtime, {
      documentId,
      fingerprint: session.fingerprint,
      request: readValidatedJson(c) as DocumentV2SyncRequest,
      userId: session.userId,
    });

    if (result.acceptedOutgoingUpdateIds.length > 0) {
      await input.publish({
        type: "document_update_created",
        documentId,
        updateIds: result.acceptedOutgoingUpdateIds,
      });
    }

    return c.json<DocumentV2SyncResponse>(result);
  } catch (error) {
    const result = handleDocumentV2MutationError(error);
    return c.json({ error: result.error }, result.status);
  }
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
    (c) => respondWithDocumentV2Create(c, runtime),
  );

  route.post(
    "/v2/documents/:documentId/link",
    requireAuth,
    validator("json", validateDocumentV2LinkSetMutationRequest),
    (c) => respondWithDocumentV2LinkSetMutation(c, runtime, "document.link"),
  );

  route.post(
    "/v2/documents/:documentId/unlink",
    requireAuth,
    validator("json", validateDocumentV2LinkSetMutationRequest),
    (c) => respondWithDocumentV2LinkSetMutation(c, runtime, "document.unlink"),
  );

  route.post(
    "/v2/documents/:documentId/sync",
    requireAuth,
    validator("json", validateDocumentV2SyncRequest),
    (c) => respondWithDocumentV2Sync(c, { publish, runtime }),
  );

  return route;
}
