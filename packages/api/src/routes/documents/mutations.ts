import {
  createDocumentOperation,
  documentSyncOperation,
  getDocumentPurgeProofOperation,
  linkDocumentOperation,
  operationRoutePath,
  purgeDocumentOperation,
  unlinkDocumentOperation,
} from "@symcrypt/validators/operation";
import type {
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentPurgeRequest,
  DocumentSyncRequest,
} from "@symcrypt/validators/request";
import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentCreateResponse,
  type DocumentLinkSetMutationResponse,
  type DocumentNotFoundErrorResponse,
  type DocumentPurgeProofResponse,
  type DocumentPurgeResponse,
  type DocumentSyncErrorResponse,
  type DocumentSyncResponse,
} from "@symcrypt/validators/response";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@symcrypt/validators/util";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  createDocument,
  DocumentMutationError,
  getDocumentPurgeProof,
  mutateDocumentLinkSet,
  purgeDocument,
  syncDocument,
} from "../../services/documents/documentMutations";
import type { ApiServiceRuntime } from "../../services/runtime";
import { uniqueSortedStrings } from "../../utils/array";
import { publishBestEffort } from "../../utils/publishBestEffort";
import {
  jsonRequestValidator,
  requestBodyLimit,
} from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";

interface DocumentMutationsRouteDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
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
    containerIds: uniqueSortedStrings(containerIds),
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
  await publishBestEffort(
    input.publish,
    createDocumentMutationCreatedEvent(input),
    "document mutation event",
  );
}

export function createDocumentUpdateCreatedEvent(input: {
  readonly documentId: string;
  readonly documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  readonly origin: DocumentMutationOrigin;
  readonly updateIds: readonly string[];
}): Record<string, unknown> {
  return {
    type: "document_update_created",
    containerIds: listDocumentKekTargetContainerIds(input.documentKekTargets),
    documentId: input.documentId,
    updateIds: [...input.updateIds],
    origin: input.origin,
  };
}

export async function publishDocumentUpdateCreatedEvent(input: {
  readonly documentId: string;
  readonly documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  readonly origin: DocumentMutationOrigin;
  readonly publish: DocumentMutationsRouteDeps["publish"];
  readonly updateIds: readonly string[];
}): Promise<void> {
  await publishBestEffort(
    input.publish,
    createDocumentUpdateCreatedEvent(input),
    "document update event",
  );
}

export function createDocumentPurgeEvent(input: {
  readonly containerIds: readonly string[];
  readonly documentId: string;
  readonly origin: DocumentMutationOrigin;
}): Record<string, unknown> {
  return {
    type: "document_mutation_created",
    containerIds: uniqueSortedStrings(input.containerIds),
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
  await publishBestEffort(
    input.publish,
    createDocumentPurgeEvent(input),
    "document purge event",
  );
}

function handleDocumentMutationError(error: unknown) {
  if (error instanceof DocumentMutationError) {
    return { code: error.code, error: error.message, status: error.status };
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
    readonly documentId: string;
    readonly eventType: DocumentLinkSetEventType;
    readonly publish: DocumentMutationsRouteDeps["publish"];
    readonly request: DocumentLinkSetMutationRequest;
    readonly runtime: ApiServiceRuntime;
  },
) {
  const { documentId } = input;
  const session = c.get("session");

  try {
    const { insertedUpdateIds, response } = await mutateDocumentLinkSet(
      input.runtime,
      {
        documentId,
        eventType: input.eventType,
        fingerprint: session.fingerprint,
        request: input.request,
        userId: session.userId,
      },
    );
    const origin = { sessionId: session.id, userId: session.userId };
    await publishDocumentMutationCreatedEvent({
      documentId,
      eventType: input.eventType,
      origin,
      publish: input.publish,
      request: input.request,
      response,
    });
    if (insertedUpdateIds.length > 0) {
      await publishDocumentUpdateCreatedEvent({
        documentId,
        documentKekTargets: response.documentKekTargets,
        origin,
        publish: input.publish,
        updateIds: insertedUpdateIds,
      });
    }
    return c.json<DocumentLinkSetMutationResponse>(response);
  } catch (error) {
    const result = handleDocumentMutationError(error);
    return c.json({ error: result.error }, result.status);
  }
}

async function respondWithDocumentSync(
  c: DocumentRouteContext,
  input: {
    readonly documentId: string;
    readonly publish: (event: Record<string, unknown>) => Promise<void>;
    readonly request: DocumentSyncRequest;
    readonly runtime: ApiServiceRuntime;
  },
) {
  const { documentId } = input;
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
      await publishDocumentUpdateCreatedEvent({
        documentId,
        documentKekTargets: response.documentKekTargets,
        origin: { sessionId: session.id, userId: session.userId },
        publish: input.publish,
        updateIds: insertedUpdateIds,
      });
    }

    return c.json<DocumentSyncResponse>(response);
  } catch (error) {
    const result = handleDocumentMutationError(error);
    if (result.status === 409) {
      return c.json<DocumentSyncErrorResponse>(
        {
          code:
            result.code === undefined ||
            result.code === DOCUMENT_NOT_FOUND_ERROR_CODE
              ? DOCUMENT_SYNC_ERROR_CODES.conflict
              : result.code,
          error: result.error,
        },
        result.status,
      );
    }
    if (
      result.status === 404 &&
      result.code === DOCUMENT_NOT_FOUND_ERROR_CODE
    ) {
      // Positively-verified deletion: the only 404 body that authorizes the
      // client's destructive local teardown. Every other 404 stays code-less
      // and the client fails closed on it.
      return c.json<DocumentNotFoundErrorResponse>(
        { code: result.code, error: result.error },
        result.status,
      );
    }
    return c.json({ error: result.error }, result.status);
  }
}

async function respondWithDocumentPurge(
  c: DocumentRouteContext,
  input: {
    readonly documentId: string;
    readonly publish: DocumentMutationsRouteDeps["publish"];
    readonly request: DocumentPurgeRequest;
    readonly runtime: ApiServiceRuntime;
  },
) {
  const { documentId } = input;
  const session = c.get("session");

  try {
    const { containerIds, response } = await purgeDocument(input.runtime, {
      documentId,
      fingerprint: session.fingerprint,
      request: input.request,
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

async function respondWithDocumentPurgeProof(
  c: DocumentRouteContext,
  input: {
    readonly documentId: string;
    readonly documentCheckpointManifestHash?: string | undefined;
    readonly runtime: ApiServiceRuntime;
  },
) {
  const session = c.get("session");

  try {
    return c.json<DocumentPurgeProofResponse>(
      await getDocumentPurgeProof(input.runtime, {
        documentCheckpointManifestHash: input.documentCheckpointManifestHash,
        documentId: input.documentId,
        userId: session.userId,
      }),
    );
  } catch (error) {
    const result = handleDocumentMutationError(error);
    return c.json({ error: result.error }, result.status);
  }
}

function registerDocumentPurgeRoutes(
  route: Hono<SessionEnv>,
  input: DocumentMutationsRouteDeps,
): void {
  route.on(
    purgeDocumentOperation.method,
    operationRoutePath(purgeDocumentOperation),
    input.requireAuth,
    pathParamsValidator(purgeDocumentOperation.params),
    jsonRequestValidator(purgeDocumentOperation.body),
    (c) =>
      respondWithDocumentPurge(c, {
        documentId: c.req.valid("param").documentId,
        publish: input.publish,
        request: c.req.valid("json"),
        runtime: input.runtime,
      }),
  );
  route.on(
    getDocumentPurgeProofOperation.method,
    operationRoutePath(getDocumentPurgeProofOperation),
    input.requireAuth,
    pathParamsValidator(getDocumentPurgeProofOperation.params),
    queryParamsValidator(getDocumentPurgeProofOperation.query),
    (c) =>
      respondWithDocumentPurgeProof(c, {
        documentCheckpointManifestHash:
          c.req.valid("query").documentCheckpointManifestHash,
        documentId: c.req.valid("param").documentId,
        runtime: input.runtime,
      }),
  );
}

export function createDocumentMutationsRoute({
  publish,
  requireAuth,
  runtime,
}: DocumentMutationsRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    createDocumentOperation.method,
    operationRoutePath(createDocumentOperation),
    requireAuth,
    jsonRequestValidator(createDocumentOperation.body),
    (c) => respondWithDocumentCreate(c, runtime, c.req.valid("json")),
  );

  route.on(
    linkDocumentOperation.method,
    operationRoutePath(linkDocumentOperation),
    requireAuth,
    pathParamsValidator(linkDocumentOperation.params),
    jsonRequestValidator(linkDocumentOperation.body),
    (c) =>
      respondWithDocumentLinkSetMutation(c, {
        documentId: c.req.valid("param").documentId,
        eventType: "document.link",
        publish,
        request: c.req.valid("json"),
        runtime,
      }),
  );

  route.on(
    unlinkDocumentOperation.method,
    operationRoutePath(unlinkDocumentOperation),
    requireAuth,
    pathParamsValidator(unlinkDocumentOperation.params),
    jsonRequestValidator(unlinkDocumentOperation.body),
    (c) =>
      respondWithDocumentLinkSetMutation(c, {
        documentId: c.req.valid("param").documentId,
        eventType: "document.unlink",
        publish,
        request: c.req.valid("json"),
        runtime,
      }),
  );

  route.on(
    documentSyncOperation.method,
    operationRoutePath(documentSyncOperation),
    requireAuth,
    pathParamsValidator(documentSyncOperation.params),
    requestBodyLimit({
      maxBytes: MAX_DOCUMENT_SYNC_REQUEST_BYTES,
      onTooLarge: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    jsonRequestValidator(documentSyncOperation.body),
    (c) =>
      respondWithDocumentSync(c, {
        documentId: c.req.valid("param").documentId,
        publish,
        request: c.req.valid("json"),
        runtime,
      }),
  );

  registerDocumentPurgeRoutes(route, { publish, requireAuth, runtime });

  return route;
}
