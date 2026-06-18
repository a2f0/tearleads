import {
  type DocumentCreateRequest,
  type DocumentLinkSetMutationRequest,
  type DocumentSyncRequest,
  isDocumentCreateRequest,
  isDocumentLinkSetMutationRequest,
  isDocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentPurgeResponse,
  DocumentSyncResponse,
} from "@tearleads/validators/response";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  createDocument,
  DocumentMutationError,
  mutateDocumentLinkSet,
  purgeDocument,
  syncDocument,
} from "../../services/documents/documentMutations";
import type { ApiServiceRuntime } from "../../services/runtime";

interface DocumentMutationsRouteDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

interface JsonValidationContext {
  json: (body: { readonly error: string }, status: 400) => Response;
}

type DocumentRouteContext = Context<SessionEnv>;
type DocumentLinkSetEventType = "document.link" | "document.unlink";

function listDocumentKekTargetContainerIds(
  documentKekTargets: DocumentSyncResponse["documentKekTargets"],
): string[] {
  return documentKekTargets.targets.flatMap((target) => {
    if (typeof target !== "object" || target === null) {
      return [];
    }

    const containerId = Reflect.get(target, "containerId");
    return typeof containerId === "string" ? [containerId] : [];
  });
}

function validateDocumentCreateRequest(
  value: unknown,
  c: JsonValidationContext,
) {
  if (!isDocumentCreateRequest(value)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return value;
}

function validateDocumentLinkSetMutationRequest(
  value: unknown,
  c: JsonValidationContext,
) {
  if (!isDocumentLinkSetMutationRequest(value)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return value;
}

function validateDocumentSyncRequest(value: unknown, c: JsonValidationContext) {
  if (!isDocumentSyncRequest(value)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return value;
}

function handleDocumentMutationError(error: unknown) {
  if (error instanceof DocumentMutationError) {
    return { error: error.message, status: error.status };
  }

  throw error;
}

async function respondWithDocumentCreate(
  c: DocumentRouteContext,
  runtime: ApiServiceRuntime,
  request: DocumentCreateRequest,
) {
  const session = c.get("session");

  try {
    return c.json<DocumentCreateResponse>(
      await createDocument(runtime, {
        fingerprint: session.fingerprint,
        request,
        userId: session.userId,
      }),
    );
  } catch (error) {
    const result = handleDocumentMutationError(error);
    return c.json({ error: result.error }, result.status);
  }
}

async function respondWithDocumentLinkSetMutation(
  c: DocumentRouteContext,
  runtime: ApiServiceRuntime,
  eventType: DocumentLinkSetEventType,
  request: DocumentLinkSetMutationRequest,
) {
  const documentId = c.req.param("documentId");
  const session = c.get("session");

  try {
    return c.json<DocumentLinkSetMutationResponse>(
      await mutateDocumentLinkSet(runtime, {
        documentId,
        eventType,
        fingerprint: session.fingerprint,
        request,
        userId: session.userId,
      }),
    );
  } catch (error) {
    const result = handleDocumentMutationError(error);
    return c.json({ error: result.error }, result.status);
  }
}

async function respondWithDocumentSync(
  c: DocumentRouteContext,
  input: {
    readonly publish: (event: Record<string, unknown>) => Promise<void>;
    readonly request: DocumentSyncRequest;
    readonly runtime: ApiServiceRuntime;
  },
) {
  const documentId = c.req.param("documentId");
  const session = c.get("session");

  try {
    const result = await syncDocument(input.runtime, {
      documentId,
      fingerprint: session.fingerprint,
      request: input.request,
      userId: session.userId,
    });

    if (result.acceptedOutgoingUpdateIds.length > 0) {
      await input.publish({
        type: "document_update_created",
        containerIds: listDocumentKekTargetContainerIds(
          result.documentKekTargets,
        ),
        documentId,
        updateIds: result.acceptedOutgoingUpdateIds,
      });
    }

    return c.json<DocumentSyncResponse>(result);
  } catch (error) {
    const result = handleDocumentMutationError(error);
    return c.json({ error: result.error }, result.status);
  }
}

async function respondWithDocumentPurge(
  c: DocumentRouteContext,
  runtime: ApiServiceRuntime,
) {
  const documentId = c.req.param("documentId");
  const session = c.get("session");

  try {
    return c.json<DocumentPurgeResponse>(
      await purgeDocument(runtime, {
        documentId,
        userId: session.userId,
      }),
    );
  } catch (error) {
    const result = handleDocumentMutationError(error);
    return c.json({ error: result.error }, result.status);
  }
}

export function createDocumentMutationsRoute({
  publish,
  requireAuth,
  runtime,
}: DocumentMutationsRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.post(
    "/documents",
    requireAuth,
    validator("json", validateDocumentCreateRequest),
    (c) => respondWithDocumentCreate(c, runtime, c.req.valid("json")),
  );

  route.post(
    "/documents/:documentId/link",
    requireAuth,
    validator("json", validateDocumentLinkSetMutationRequest),
    (c) =>
      respondWithDocumentLinkSetMutation(
        c,
        runtime,
        "document.link",
        c.req.valid("json"),
      ),
  );

  route.post(
    "/documents/:documentId/unlink",
    requireAuth,
    validator("json", validateDocumentLinkSetMutationRequest),
    (c) =>
      respondWithDocumentLinkSetMutation(
        c,
        runtime,
        "document.unlink",
        c.req.valid("json"),
      ),
  );

  route.post(
    "/documents/:documentId/sync",
    requireAuth,
    validator("json", validateDocumentSyncRequest),
    (c) =>
      respondWithDocumentSync(c, {
        publish,
        request: c.req.valid("json"),
        runtime,
      }),
  );

  route.delete("/documents/:documentId", requireAuth, (c) =>
    respondWithDocumentPurge(c, runtime),
  );

  return route;
}
