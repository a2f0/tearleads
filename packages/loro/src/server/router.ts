import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { readEncryptedUpdateAccessEpoch } from "../encryptedUpdate";
import {
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  DOCUMENT_RECIPIENT_ENVELOPES_CONFLICT_MESSAGE,
  type DocumentRecipientEnvelopeAction,
  type DocumentSyncUpdate,
  isCreateDocumentRequest,
  isSyncDocumentRequest,
  type SerializedRecipientEnvelope,
  type SyncDocumentMissingUpdateEpoch,
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
  currentAccessStateHash: string;
  documentRecipientEnvelopeAction: DocumentRecipientEnvelopeAction;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
  rotateBaselineSourceVersionVector: string | null;
  recipientKeyFingerprints: string[];
  recipientEncapsulationPublicKeys: string[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}

interface AppendDocumentUpdatesResult {
  acceptedOutgoingUpdateIds: string[];
  commitLsn: string | null;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | undefined;
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
      currentAccessStateHash: string;
      documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
      recipientEncapsulationPublicKeys: string[];
      referencedPrincipals: ReferencedPrincipalStateResponse[];
    } | null>;
    getDocumentById(documentId: string): Promise<DocumentRecord | null>;
    getDocumentAccess(input: {
      documentId: string;
      userId: string;
    }): Promise<DocumentAccessState | null>;
    appendDocumentUpdates(input: {
      authorUserId: string;
      documentId: string;
      authorFingerprint: string;
      documentRecipientEnvelopes?: SerializedRecipientEnvelope[];
      updates: SyncDocumentOutgoingUpdate[];
    }): Promise<AppendDocumentUpdatesResult>;
    listMissingDocumentUpdates(input: {
      documentId: string;
      localVersionVector: string | null;
      minLsn?: string | undefined;
    }): Promise<DocumentUpdateRecord[]>;
    readCurrentCommitLsn(): Promise<string>;
  };
  publish: (event: Record<string, unknown>) => Promise<void>;
  requireAuth: MiddlewareHandler<LoroEnv<TSession>>;
}

interface StatusError extends Error {
  status: 400 | 403 | 404 | 409 | 503;
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
    accessEpoch: update.accessEpoch,
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
        currentAccessStateHash: created.currentAccessStateHash,
        documentRecipientEnvelopes: created.documentRecipientEnvelopes,
        recipientEncapsulationPublicKeys:
          created.recipientEncapsulationPublicKeys,
        referencedPrincipals: created.referencedPrincipals,
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
    authorUserId: string;
    documentId: string;
    documentRecipientEnvelopes: SerializedRecipientEnvelope[] | undefined;
    outgoingUpdates: SyncDocumentOutgoingUpdate[];
  },
): Promise<AppendDocumentUpdatesResult> {
  if (
    input.outgoingUpdates.length === 0 &&
    input.documentRecipientEnvelopes === undefined
  ) {
    return {
      acceptedOutgoingUpdateIds: [],
      commitLsn: null,
      documentRecipientEnvelopes: undefined,
    };
  }

  return store.appendDocumentUpdates({
    authorUserId: input.authorUserId,
    documentId: input.documentId,
    authorFingerprint: input.authorFingerprint,
    updates: input.outgoingUpdates,
    ...(input.documentRecipientEnvelopes
      ? { documentRecipientEnvelopes: input.documentRecipientEnvelopes }
      : {}),
  });
}

async function tryAppendOutgoingDocumentUpdates<TSession extends SessionLike>(
  store: LoroRouterDeps<TSession>["store"],
  input: {
    authorFingerprint: string;
    authorUserId: string;
    documentId: string;
    documentRecipientEnvelopes: SerializedRecipientEnvelope[] | undefined;
    outgoingUpdates: SyncDocumentOutgoingUpdate[];
  },
): Promise<
  | { appendResult: AppendDocumentUpdatesResult }
  | { error: string; status: StatusError["status"] }
> {
  try {
    return {
      appendResult: await appendOutgoingDocumentUpdates(store, input),
    };
  } catch (error) {
    if (isStatusError(error)) {
      return { error: error.message, status: error.status };
    }
    throw error;
  }
}

interface SyncAccessError {
  error: string;
  status: 403 | 404 | 500;
}

type SyncRouteErrorStatus = StatusError["status"] | SyncAccessError["status"];

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

function isDocumentRecipientEnvelopesConflict(appendAttempt: {
  error: string;
  status: StatusError["status"];
}): boolean {
  return (
    appendAttempt.status === 409 &&
    appendAttempt.error === DOCUMENT_RECIPIENT_ENVELOPES_CONFLICT_MESSAGE
  );
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

async function appendCurrentEpochOutgoingUpdates<TSession extends SessionLike>(
  store: LoroRouterDeps<TSession>["store"],
  input: {
    accessEpoch: number;
    currentAccess: DocumentAccessState;
    documentId: string;
    documentRecipientEnvelopes: SerializedRecipientEnvelope[] | undefined;
    outgoingUpdates: SyncDocumentOutgoingUpdate[];
    session: TSession;
  },
): Promise<
  | {
      acceptedOutgoingUpdateIds: string[];
      access: DocumentAccessState;
      canonicalDocumentRecipientEnvelopesAdopted: boolean;
      commitLsn: string | null;
      documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
    }
  | { error: string; status: SyncRouteErrorStatus }
> {
  const invalidUpdateMessage = validateOutgoingUpdatesForAccessEpoch(
    input.outgoingUpdates,
    input.accessEpoch,
  );
  if (invalidUpdateMessage) {
    return { error: invalidUpdateMessage, status: 400 };
  }

  const appendAttempt = await tryAppendOutgoingDocumentUpdates(store, {
    authorFingerprint: input.session.fingerprint,
    authorUserId: input.session.userId,
    documentId: input.documentId,
    documentRecipientEnvelopes: input.documentRecipientEnvelopes,
    outgoingUpdates: input.outgoingUpdates,
  });

  if ("error" in appendAttempt) {
    if (!isDocumentRecipientEnvelopesConflict(appendAttempt)) {
      return appendAttempt;
    }

    const refreshedSyncAccess = await loadSyncDocumentAccess(
      store,
      input.documentId,
      input.session.userId,
    );
    if (!refreshedSyncAccess.access) {
      return {
        error: refreshedSyncAccess.error,
        status: refreshedSyncAccess.status,
      };
    }

    return {
      acceptedOutgoingUpdateIds: [],
      access: refreshedSyncAccess.access,
      canonicalDocumentRecipientEnvelopesAdopted: true,
      commitLsn: null,
      documentRecipientEnvelopes:
        refreshedSyncAccess.access.documentRecipientEnvelopes,
    };
  }

  const { appendResult } = appendAttempt;

  return {
    acceptedOutgoingUpdateIds: appendResult.acceptedOutgoingUpdateIds,
    access: input.currentAccess,
    canonicalDocumentRecipientEnvelopesAdopted: false,
    commitLsn: appendResult.commitLsn,
    documentRecipientEnvelopes:
      appendResult.documentRecipientEnvelopes ??
      input.currentAccess.documentRecipientEnvelopes,
  };
}

function getMissingUpdateEpochs(
  updates: ReadonlyArray<DocumentSyncUpdate>,
  currentAccessEpoch: number,
): SyncDocumentMissingUpdateEpoch[] {
  let hasPriorEpochUpdate = false;
  let hasCurrentEpochUpdate = false;

  for (const update of updates) {
    if (update.accessEpoch < currentAccessEpoch) {
      hasPriorEpochUpdate = true;
      continue;
    }

    if (update.accessEpoch === currentAccessEpoch) {
      hasCurrentEpochUpdate = true;
    }
  }

  const missingUpdateEpochs: SyncDocumentMissingUpdateEpoch[] = [];
  if (hasPriorEpochUpdate) {
    missingUpdateEpochs.push("prior_epoch");
  }
  if (hasCurrentEpochUpdate) {
    missingUpdateEpochs.push("current_epoch");
  }

  return missingUpdateEpochs;
}

async function listMissingSyncUpdates<TSession extends SessionLike>(
  store: LoroRouterDeps<TSession>["store"],
  input: {
    documentId: string;
    localVersionVector: string | null;
    minLsn?: string | undefined;
  },
) {
  return (
    await store.listMissingDocumentUpdates({
      documentId: input.documentId,
      localVersionVector: input.localVersionVector,
      minLsn: input.minLsn,
    })
  ).map((update) => toSyncUpdate(update));
}

async function buildSyncDocumentResponse<TSession extends SessionLike>(input: {
  access: DocumentAccessState;
  acceptedOutgoingUpdateIds: string[];
  canonicalDocumentRecipientEnvelopesAdopted: boolean;
  commitLsn: string | null;
  documentId: string;
  missingUpdates: DocumentSyncUpdate[];
  responseDocumentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
  store: LoroRouterDeps<TSession>["store"];
}): Promise<SyncDocumentResponse> {
  return {
    documentId: input.documentId,
    acceptedOutgoingUpdateIds: input.acceptedOutgoingUpdateIds,
    canonicalDocumentRecipientEnvelopesAdopted:
      input.canonicalDocumentRecipientEnvelopesAdopted,
    commitLsn: input.commitLsn ?? (await input.store.readCurrentCommitLsn()),
    missingUpdateEpochs: getMissingUpdateEpochs(
      input.missingUpdates,
      input.access.currentAccessEpoch,
    ),
    updates: input.missingUpdates,
    currentAccessEpoch: input.access.currentAccessEpoch,
    currentAccessStateHash: input.access.currentAccessStateHash,
    documentRecipientEnvelopeAction:
      input.access.documentRecipientEnvelopeAction,
    documentRecipientEnvelopes: input.responseDocumentRecipientEnvelopes,
    rotateBaselineSourceVersionVector:
      input.access.rotateBaselineSourceVersionVector,
    recipientEncapsulationPublicKeys:
      input.access.recipientEncapsulationPublicKeys,
    referencedPrincipals: input.access.referencedPrincipals,
  };
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
      minLsn,
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
    let access = syncAccess.access;

    const writeAccessError = getWriteAccessError(access, outgoingUpdates);
    if (writeAccessError) {
      return c.json({ error: writeAccessError.error }, writeAccessError.status);
    }

    let acceptedOutgoingUpdateIds: string[] = [];
    let canonicalDocumentRecipientEnvelopesAdopted = false;
    let commitLsn: string | null = null;
    let responseDocumentRecipientEnvelopes = access.documentRecipientEnvelopes;

    if (accessEpoch === access.currentAccessEpoch) {
      const appendResult = await appendCurrentEpochOutgoingUpdates(store, {
        accessEpoch,
        currentAccess: access,
        documentId,
        documentRecipientEnvelopes,
        outgoingUpdates,
        session,
      });
      if ("error" in appendResult) {
        return c.json({ error: appendResult.error }, appendResult.status);
      }

      access = appendResult.access;
      acceptedOutgoingUpdateIds = appendResult.acceptedOutgoingUpdateIds;
      canonicalDocumentRecipientEnvelopesAdopted =
        appendResult.canonicalDocumentRecipientEnvelopesAdopted;
      commitLsn = appendResult.commitLsn;
      responseDocumentRecipientEnvelopes =
        appendResult.documentRecipientEnvelopes;
    }

    let missingUpdates: DocumentSyncUpdate[];
    try {
      missingUpdates = await listMissingSyncUpdates(store, {
        documentId,
        localVersionVector,
        minLsn,
      });
    } catch (error) {
      if (isStatusError(error)) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
    if (acceptedOutgoingUpdateIds.length > 0) {
      await publish({
        type: "document_update_created",
        documentId,
        updateIds: acceptedOutgoingUpdateIds,
      });
    }

    return c.json<SyncDocumentResponse>(
      await buildSyncDocumentResponse({
        access,
        acceptedOutgoingUpdateIds,
        canonicalDocumentRecipientEnvelopesAdopted,
        commitLsn,
        documentId,
        missingUpdates,
        responseDocumentRecipientEnvelopes,
        store,
      }),
    );
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
