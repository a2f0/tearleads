import { type Context, Hono, type MiddlewareHandler } from "hono";
import { satisfiesVersionVector } from "../document";
import { readEncryptedUpdateAccessEpoch } from "../encryptedUpdate";
import {
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  type DocumentSyncUpdate,
  isCreateDocumentRequest,
  isSyncDocumentRequest,
  type SerializedRecipientEnvelope,
  type SyncDocumentOutgoingUpdate,
  type SyncDocumentRequest,
  type SyncDocumentResponse,
} from "../shared";
import type { DocumentRecord, DocumentUpdateRecord } from "./schema";

interface SessionLike {
  userId: string;
  fingerprint: string;
}

type LoroEnv<TSession extends SessionLike> = {
  Variables: {
    session: TSession;
  };
};

interface DocumentAccessState {
  canRead: boolean;
  canWrite: boolean;
  currentAccessEpoch: number;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
  recipientKeyFingerprints: string[];
  recipientEncapsulationPublicKeys: string[];
}

interface LoroRouterDeps<TSession extends SessionLike> {
  store: {
    createDocument(input: {
      createdByFingerprint: string;
      createdByUserId: string;
      linkedContainerIds: string[];
    }): Promise<{
      document: DocumentRecord;
      currentAccessEpoch: number;
      documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
      recipientEncapsulationPublicKeys: string[];
    } | null>;
    getDocumentById(documentId: string): Promise<DocumentRecord | null>;
    getDocumentAccess(input: {
      documentId: string;
      userId: string;
    }): Promise<DocumentAccessState | null>;
    appendDocumentUpdates(input: {
      documentId: string;
      authorFingerprint: string;
      documentRecipientEnvelopes?: SerializedRecipientEnvelope[];
      updates: SyncDocumentOutgoingUpdate[];
    }): Promise<string[]>;
    listDocumentUpdates(documentId: string): Promise<DocumentUpdateRecord[]>;
  };
  publish: (event: Record<string, unknown>) => Promise<void>;
  requireAuth: MiddlewareHandler<LoroEnv<TSession>>;
}

interface StatusError extends Error {
  status: 400 | 403 | 404 | 409;
}

function isStatusError(error: unknown): error is StatusError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  );
}

function matchesAccessEpoch(
  encryptedData: string,
  expectedAccessEpoch: number,
): boolean {
  return readEncryptedUpdateAccessEpoch(encryptedData) === expectedAccessEpoch;
}

function toSyncUpdate(update: DocumentUpdateRecord): DocumentSyncUpdate {
  return {
    id: update.id,
    documentId: update.documentId,
    authorFingerprint: update.authorFingerprint,
    encryptedData: update.encryptedData,
    partialStartVersionVector: update.partialStartVersionVector,
    partialEndVersionVector: update.partialEndVersionVector,
    createdAt: update.createdAt.toISOString(),
  };
}

function createDocumentRouteHandler<TSession extends SessionLike>(
  store: LoroRouterDeps<TSession>["store"],
) {
  return async (c: Context<LoroEnv<TSession>>) => {
    const session = c.get("session");
    const request = await c.req.json();
    if (!isCreateDocumentRequest(request)) {
      return c.json({ error: "Invalid request" }, 400);
    }
    const { linkedContainerIds }: CreateDocumentRequest = request;

    try {
      const created = await store.createDocument({
        createdByFingerprint: session.fingerprint,
        createdByUserId: session.userId,
        linkedContainerIds,
      });

      if (!created) {
        return c.json({ error: "Failed to create document" }, 500);
      }

      return c.json<CreateDocumentResponse>({
        id: created.document.id,
        createdAt: created.document.createdAt.toISOString(),
        currentAccessEpoch: created.currentAccessEpoch,
        documentRecipientEnvelopes: created.documentRecipientEnvelopes,
        recipientEncapsulationPublicKeys:
          created.recipientEncapsulationPublicKeys,
      });
    } catch (error) {
      if (isStatusError(error)) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  };
}

function validateOutgoingUpdatesForAccessEpoch(
  outgoingUpdates: SyncDocumentOutgoingUpdate[],
  accessEpoch: number,
) {
  for (const outgoingUpdate of outgoingUpdates) {
    try {
      if (!matchesAccessEpoch(outgoingUpdate.encryptedData, accessEpoch)) {
        return "Encrypted update access epoch mismatch";
      }
    } catch {
      return "Invalid encrypted update envelope";
    }
  }

  return null;
}

async function appendOutgoingDocumentUpdates<TSession extends SessionLike>(
  store: LoroRouterDeps<TSession>["store"],
  input: {
    authorFingerprint: string;
    documentId: string;
    documentRecipientEnvelopes: SerializedRecipientEnvelope[] | undefined;
    outgoingUpdates: SyncDocumentOutgoingUpdate[];
  },
) {
  if (
    input.outgoingUpdates.length === 0 &&
    input.documentRecipientEnvelopes === undefined
  ) {
    return {
      acceptedOutgoingUpdateIds: [],
      responseDocumentRecipientEnvelopes: undefined,
    };
  }

  const acceptedOutgoingUpdateIds = await store.appendDocumentUpdates({
    documentId: input.documentId,
    authorFingerprint: input.authorFingerprint,
    updates: input.outgoingUpdates,
    ...(input.documentRecipientEnvelopes
      ? { documentRecipientEnvelopes: input.documentRecipientEnvelopes }
      : {}),
  });

  return {
    acceptedOutgoingUpdateIds,
    responseDocumentRecipientEnvelopes: input.documentRecipientEnvelopes,
  };
}

interface SyncAccessError {
  error: string;
  status: 403 | 404 | 500;
}

type SyncAccessResult =
  | { access: DocumentAccessState }
  | { access: null; error: string; status: 403 | 404 | 500 };

async function parseSyncDocumentRequest<TSession extends SessionLike>(
  c: Context<LoroEnv<TSession>>,
) {
  const request = await c.req.json();
  if (!isSyncDocumentRequest(request)) {
    return null;
  }
  return request;
}

async function loadSyncDocumentAccess<TSession extends SessionLike>(
  store: LoroRouterDeps<TSession>["store"],
  documentId: string,
  userId: string,
): Promise<SyncAccessResult> {
  const document = await store.getDocumentById(documentId);
  if (!document) {
    return {
      access: null,
      error: "Document not found",
      status: 404,
    };
  }

  const access = await store.getDocumentAccess({
    documentId,
    userId,
  });
  if (!access) {
    return {
      access: null,
      error: "Document access state not found",
      status: 500,
    };
  }
  if (!access.canRead) {
    return { access: null, error: "Forbidden", status: 403 };
  }

  return { access };
}

function getWriteAccessError(
  access: DocumentAccessState,
  outgoingUpdates: SyncDocumentOutgoingUpdate[],
): SyncAccessError | null {
  if (outgoingUpdates.length > 0 && !access.canWrite) {
    return { error: "Forbidden", status: 403 };
  }

  return null;
}

async function listMissingSyncUpdates<TSession extends SessionLike>(
  store: LoroRouterDeps<TSession>["store"],
  documentId: string,
  localVersionVector: string | null,
) {
  const updates = await store.listDocumentUpdates(documentId);
  return updates
    .filter(
      (update) =>
        !satisfiesVersionVector(
          localVersionVector,
          update.partialEndVersionVector,
        ),
    )
    .map((update) => toSyncUpdate(update));
}

function createSyncDocumentRouteHandler<TSession extends SessionLike>(
  store: LoroRouterDeps<TSession>["store"],
  publish: LoroRouterDeps<TSession>["publish"],
) {
  return async (c: Context<LoroEnv<TSession>>) => {
    const documentId = c.req.param("documentId");
    const request = await parseSyncDocumentRequest(c);
    if (!request) {
      return c.json({ error: "Invalid request" }, 400);
    }
    const {
      accessEpoch,
      documentRecipientEnvelopes,
      localVersionVector,
      outgoingUpdates,
    }: SyncDocumentRequest = request;
    const session = c.get("session");

    const syncAccess = await loadSyncDocumentAccess(
      store,
      documentId,
      session.userId,
    );
    if (!syncAccess.access) {
      return c.json({ error: syncAccess.error }, syncAccess.status);
    }
    const access = syncAccess.access;

    const writeAccessError = getWriteAccessError(access, outgoingUpdates);
    if (writeAccessError) {
      return c.json({ error: writeAccessError.error }, writeAccessError.status);
    }

    let acceptedOutgoingUpdateIds: string[] = [];
    let responseDocumentRecipientEnvelopes = access.documentRecipientEnvelopes;

    if (accessEpoch === access.currentAccessEpoch) {
      const invalidUpdateMessage = validateOutgoingUpdatesForAccessEpoch(
        outgoingUpdates,
        accessEpoch,
      );
      if (invalidUpdateMessage) {
        return c.json({ error: invalidUpdateMessage }, 400);
      }

      const appendResult = await appendOutgoingDocumentUpdates(store, {
        authorFingerprint: session.fingerprint,
        documentId,
        documentRecipientEnvelopes,
        outgoingUpdates,
      });
      acceptedOutgoingUpdateIds = appendResult.acceptedOutgoingUpdateIds;
      if (appendResult.responseDocumentRecipientEnvelopes) {
        responseDocumentRecipientEnvelopes =
          appendResult.responseDocumentRecipientEnvelopes;
      }
    }

    const missingUpdates = await listMissingSyncUpdates(
      store,
      documentId,
      localVersionVector,
    );
    if (acceptedOutgoingUpdateIds.length > 0) {
      await publish({
        type: "document_update_created",
        documentId,
        updateIds: acceptedOutgoingUpdateIds,
      });
    }

    return c.json<SyncDocumentResponse>({
      documentId,
      acceptedOutgoingUpdateIds,
      updates: missingUpdates,
      currentAccessEpoch: access.currentAccessEpoch,
      documentRecipientEnvelopes: responseDocumentRecipientEnvelopes,
      recipientEncapsulationPublicKeys: access.recipientEncapsulationPublicKeys,
    });
  };
}

export function createLoroRouter<TSession extends SessionLike>({
  store,
  publish,
  requireAuth,
}: LoroRouterDeps<TSession>) {
  const router = new Hono<LoroEnv<TSession>>();
  const createDocument = createDocumentRouteHandler(store);
  const syncDocument = createSyncDocumentRouteHandler(store, publish);

  router.post("/documents", requireAuth, createDocument);

  router.post("/documents/:documentId/sync", requireAuth, syncDocument);

  return router;
}
