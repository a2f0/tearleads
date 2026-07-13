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
type DocumentMutationOrigin = {
  readonly sessionId: string;
  readonly userId: string;
};

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

/**
 * Build the lossy realtime hint for a committed document link-set mutation.
 * Each endpoint changes exactly one target container. The response carries the
 * complete current link set, so adding that mutation target yields the exact
 * union of the previous and current sets for both link and unlink.
 */
export function createDocumentMutationCreatedEvent(input: {
  readonly documentId: string;
  readonly eventType: DocumentLinkSetEventType;
  readonly origin: DocumentMutationOrigin;
  readonly request: DocumentLinkSetMutationRequest;
  readonly response: DocumentLinkSetMutationResponse;
}): Record<string, unknown> {
  const mutationTargetContainerId =
    input.request.targetContainerPathRefs.at(-1)?.containerId;
  const containerIds = [
    ...listDocumentKekTargetContainerIds(input.response.documentKekTargets),
    ...(mutationTargetContainerId ? [mutationTargetContainerId] : []),
  ];

  return {
    type: "document_mutation_created",
    containerIds: [...new Set(containerIds)].sort(),
    documentId: input.documentId,
    eventType: input.eventType,
    origin: input.origin,
  };
}

export async function publishDocumentMutationCreatedEvent(input: {
  readonly documentId: string;
  readonly eventType: DocumentLinkSetEventType;
  readonly origin: DocumentMutationOrigin;
  readonly publish: DocumentMutationsRouteDeps["publish"];
  readonly request: DocumentLinkSetMutationRequest;
  readonly response: DocumentLinkSetMutationResponse;
}): Promise<void> {
  try {
    await input.publish(createDocumentMutationCreatedEvent(input));
  } catch (error) {
    // The link-set transaction already committed. Realtime is a lossy hint;
    // HTTP reconciliation remains authoritative, so a broker outage must not
    // turn a successful mutation into a misleading 500/retry.
    console.error("Failed to publish document mutation event:", error);
  }
}

export function createDocumentPurgeEvent(input: {
  readonly containerIds: readonly string[];
  readonly documentId: string;
  readonly origin: DocumentMutationOrigin;
}): Record<string, unknown> {
  return {
    type: "document_mutation_created",
    containerIds: [...new Set(input.containerIds)].sort(),
    documentId: input.documentId,
    eventType: "document.purge",
    origin: input.origin,
  };
}

export async function publishDocumentPurgeEvent(input: {
  readonly containerIds: readonly string[];
  readonly documentId: string;
  readonly origin: DocumentMutationOrigin;
  readonly publish: DocumentMutationsRouteDeps["publish"];
}): Promise<void> {
  try {
    await input.publish(createDocumentPurgeEvent(input));
  } catch (error) {
    // The purge and its tombstone already committed. Realtime only wakes peers
    // to consume that tombstone, so publication must not change the HTTP result.
    console.error("Failed to publish document purge event:", error);
  }
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
  input: {
    readonly eventType: DocumentLinkSetEventType;
    readonly publish: DocumentMutationsRouteDeps["publish"];
    readonly request: DocumentLinkSetMutationRequest;
    readonly runtime: ApiServiceRuntime;
  },
) {
  const documentId = c.req.param("documentId");
  const session = c.get("session");

  try {
    const response = await mutateDocumentLinkSet(input.runtime, {
      documentId,
      eventType: input.eventType,
      fingerprint: session.fingerprint,
      request: input.request,
      userId: session.userId,
    });
    await publishDocumentMutationCreatedEvent({
      documentId,
      eventType: input.eventType,
      origin: { sessionId: session.id, userId: session.userId },
      publish: input.publish,
      request: input.request,
      response,
    });
    return c.json<DocumentLinkSetMutationResponse>(response);
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
    const { insertedUpdateIds, response } = await syncDocument(input.runtime, {
      documentId,
      fingerprint: session.fingerprint,
      request: input.request,
      userId: session.userId,
    });

    // Broadcast only when this sync inserted new content. An idempotent retry
    // re-acknowledges updates that already exist (they stay in the response's
    // acceptedOutgoingUpdateIds for the caller's own reconciliation), but
    // inserts nothing new, so re-pinging peers would be a redundant pull. The
    // updates were already broadcast when first inserted; a peer that missed
    // that hint recovers on its next reconcile, per the lossy-hint contract.
    if (insertedUpdateIds.length > 0) {
      await input.publish({
        type: "document_update_created",
        containerIds: listDocumentKekTargetContainerIds(
          response.documentKekTargets,
        ),
        documentId,
        updateIds: insertedUpdateIds,
        // Tag the event with the session that authored these updates so the ws
        // router can skip echoing them back over this session's own socket.
        // session.id is the same value the ws ticket is minted from, so it
        // matches that connection's identity. The router strips `origin` before
        // forwarding, so it never reaches any client.
        origin: { sessionId: session.id, userId: session.userId },
      });
    }

    return c.json<DocumentSyncResponse>(response);
  } catch (error) {
    const result = handleDocumentMutationError(error);
    return c.json({ error: result.error }, result.status);
  }
}

async function respondWithDocumentPurge(
  c: DocumentRouteContext,
  input: {
    readonly publish: DocumentMutationsRouteDeps["publish"];
    readonly runtime: ApiServiceRuntime;
  },
) {
  const documentId = c.req.param("documentId");
  const session = c.get("session");

  try {
    const { containerIds, response } = await purgeDocument(input.runtime, {
      documentId,
      userId: session.userId,
    });
    await publishDocumentPurgeEvent({
      containerIds,
      documentId,
      origin: { sessionId: session.id, userId: session.userId },
      publish: input.publish,
    });
    return c.json<DocumentPurgeResponse>(response);
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
      respondWithDocumentLinkSetMutation(c, {
        eventType: "document.link",
        publish,
        request: c.req.valid("json"),
        runtime,
      }),
  );

  route.post(
    "/documents/:documentId/unlink",
    requireAuth,
    validator("json", validateDocumentLinkSetMutationRequest),
    (c) =>
      respondWithDocumentLinkSetMutation(c, {
        eventType: "document.unlink",
        publish,
        request: c.req.valid("json"),
        runtime,
      }),
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
    respondWithDocumentPurge(c, { publish, runtime }),
  );

  return route;
}
