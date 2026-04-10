import {
  emptyVersionVector,
  mergeVersionVectors,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";
import type {
  DocumentRecord,
  DocumentUpdateRecord,
} from "@tearleads/loro/server";
import type {
  DocumentRecipientEnvelopeAction,
  SerializedRecipientEnvelope,
  SyncDocumentOutgoingUpdate,
} from "@tearleads/loro/shared";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { and, eq, inArray, lt } from "drizzle-orm";
import {
  canWriteContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  canReadDocumentAccess,
  canWriteDocumentAccess,
  createDocumentRecipientEnvelopes,
  DocumentRecipientEnvelopeConflictError,
  documentRecipientEnvelopesMatchRecipients,
  getDocumentRecipientEnvelopeAction,
  initializeDocumentAccess,
  listDocumentRecipientEnvelopes,
  listRecipientEncapsulationPublicKeys,
  listRecipientKeyFingerprints,
  putDocumentRecipientEnvelopes,
  replaceDocumentRecipientEnvelopes,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import type { DatabaseExecutor } from "../../adapters/postgres";
import {
  containers,
  documentContainerLinks,
  documents,
  documentUpdates,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";
import type { ApiServiceRuntime } from "../runtime";

type DocumentSyncExecutor = DatabaseExecutor;
type DocumentAccess = NonNullable<
  Awaited<ReturnType<typeof resolveDocumentAccessState>>
>;

interface DocumentRotateBaselineUpdate {
  partialEndVersionVector: string;
  sourceVersionVector?: string;
}

interface AppendDocumentUpdate extends DocumentRotateBaselineUpdate {
  encryptedData: string;
  id: string;
  partialStartVersionVector: string;
}

interface DocumentAccessState {
  canRead: boolean;
  canWrite: boolean;
  currentAccessEpoch: number;
  documentRecipientEnvelopeAction: DocumentRecipientEnvelopeAction;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
  rotateBaselineSourceVersionVector: string | null;
  recipientKeyFingerprints: string[];
  recipientEncapsulationPublicKeys: string[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}

interface AppendDocumentUpdatesResult {
  acceptedOutgoingUpdateIds: string[];
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | undefined;
}

interface CreateDocumentInput {
  createdByFingerprint: string;
  createdByUserId: string;
  linkedContainerIds: string[];
}

type LinkedContainerRow = {
  id: string;
  organizationId: string;
};

type CreatedDocumentResult = NonNullable<
  Awaited<ReturnType<DocumentSyncStore["createDocument"]>>
>;

interface DocumentSyncStore {
  createDocument(input: {
    createdByFingerprint: string;
    createdByUserId: string;
    linkedContainerIds: string[];
  }): Promise<{
    document: DocumentRecord;
    currentAccessEpoch: number;
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
    documentId: string;
    authorFingerprint: string;
    documentRecipientEnvelopes?: SerializedRecipientEnvelope[];
    updates: SyncDocumentOutgoingUpdate[];
  }): Promise<AppendDocumentUpdatesResult>;
  listDocumentUpdates(documentId: string): Promise<DocumentUpdateRecord[]>;
}

export class CreateDocumentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export class DocumentUpdateError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

async function getPriorEpochDocumentVersionVector(
  documentId: string,
  currentAccessEpoch: number,
  executor: DocumentSyncExecutor,
): Promise<string> {
  const rows = await executor
    .select({
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
    })
    .from(documentUpdates)
    .where(
      and(
        eq(documentUpdates.documentId, documentId),
        lt(documentUpdates.accessEpoch, currentAccessEpoch),
      ),
    );

  if (rows.length === 0) {
    return emptyVersionVector();
  }

  return mergeVersionVectors(rows.map((row) => row.partialEndVersionVector));
}

export async function getRotateBaselineSourceError(input: {
  currentAccessEpoch: number;
  currentDocumentRecipientEnvelopes: ReadonlyArray<unknown> | null;
  documentId: string;
  documentRecipientEnvelopeAction: "none" | "rewrap" | "rotate";
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | undefined;
  executor: DocumentSyncExecutor;
  updates: ReadonlyArray<DocumentRotateBaselineUpdate>;
}): Promise<{ message: string; status: 400 | 409 } | null> {
  if (
    input.documentRecipientEnvelopeAction !== "rotate" ||
    !input.documentRecipientEnvelopes ||
    (input.currentDocumentRecipientEnvelopes &&
      input.currentDocumentRecipientEnvelopes.length > 0)
  ) {
    return null;
  }

  if (input.updates.length !== 1) {
    return {
      message: "Rotate baseline requires exactly one document update",
      status: 400,
    };
  }

  const update = input.updates[0];
  if (!update?.sourceVersionVector) {
    return {
      message: "Missing rotate baseline source version vector",
      status: 400,
    };
  }

  const expectedSourceVersionVector = await getPriorEpochDocumentVersionVector(
    input.documentId,
    input.currentAccessEpoch,
    input.executor,
  );

  if (
    !versionVectorsEqual(
      update.sourceVersionVector,
      expectedSourceVersionVector,
    )
  ) {
    return {
      message: "Stale rotate baseline source version vector",
      status: 409,
    };
  }

  if (
    !satisfiesVersionVector(
      update.partialEndVersionVector,
      expectedSourceVersionVector,
    )
  ) {
    return {
      message:
        "Rotate baseline frontier does not cover all prior-epoch updates",
      status: 409,
    };
  }

  return null;
}

async function validateAppendDocumentUpdatesInput(input: {
  access: DocumentAccess;
  documentId: string;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | undefined;
  executor: DocumentSyncExecutor;
  updates: ReadonlyArray<AppendDocumentUpdate>;
}) {
  const existingEnvelopes = await listDocumentRecipientEnvelopes(
    input.documentId,
    input.access.currentAccessEpoch,
    input.executor,
  );
  const nextEnvelopes = input.documentRecipientEnvelopes ?? existingEnvelopes;

  if (!nextEnvelopes || nextEnvelopes.length === 0) {
    throw new DocumentUpdateError(
      "Missing document recipient envelopes for current epoch",
      400,
    );
  }

  if (
    input.documentRecipientEnvelopes &&
    !documentRecipientEnvelopesMatchRecipients(
      input.documentRecipientEnvelopes,
      input.access,
    )
  ) {
    throw new DocumentUpdateError("Document recipient envelopes mismatch", 400);
  }

  const documentRecipientEnvelopeAction =
    await getDocumentRecipientEnvelopeAction(
      input.documentId,
      input.access,
      input.executor,
    );
  const rotateBaselineSourceError = await getRotateBaselineSourceError({
    currentAccessEpoch: input.access.currentAccessEpoch,
    currentDocumentRecipientEnvelopes: existingEnvelopes,
    documentId: input.documentId,
    documentRecipientEnvelopeAction,
    documentRecipientEnvelopes: input.documentRecipientEnvelopes,
    executor: input.executor,
    updates: input.updates,
  });
  if (rotateBaselineSourceError) {
    throw new DocumentUpdateError(
      rotateBaselineSourceError.message,
      rotateBaselineSourceError.status,
    );
  }
}

async function putAppendDocumentRecipientEnvelopes(input: {
  access: DocumentAccess;
  documentId: string;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | undefined;
  executor: DocumentSyncExecutor;
}): Promise<
  Awaited<ReturnType<typeof putDocumentRecipientEnvelopes>> | undefined
> {
  if (!input.documentRecipientEnvelopes) {
    return undefined;
  }

  try {
    return await putDocumentRecipientEnvelopes(
      input.documentId,
      input.access.currentAccessEpoch,
      input.access,
      input.documentRecipientEnvelopes,
      input.executor,
    );
  } catch (error) {
    if (error instanceof DocumentRecipientEnvelopeConflictError) {
      throw new DocumentUpdateError(error.message, 409);
    }
    throw error;
  }
}

async function appendMissingDocumentUpdates(input: {
  accessEpoch: number;
  authorFingerprint: string;
  documentId: string;
  executor: DocumentSyncExecutor;
  updates: ReadonlyArray<AppendDocumentUpdate>;
}): Promise<string[]> {
  if (input.updates.length === 0) {
    return [];
  }

  const updateIds = uniqueSortedStrings(
    input.updates.map((update) => update.id),
  );
  const existingRows = await input.executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(inArray(documentUpdates.id, updateIds));
  const acceptedUpdateIds = new Set(existingRows.map((row) => row.id));
  const newUpdates: AppendDocumentUpdate[] = [];

  for (const update of input.updates) {
    if (acceptedUpdateIds.has(update.id)) {
      continue;
    }

    acceptedUpdateIds.add(update.id);
    newUpdates.push(update);
  }

  if (newUpdates.length > 0) {
    const insertedRows = await input.executor
      .insert(documentUpdates)
      .values(
        newUpdates.map((update) => ({
          id: update.id,
          documentId: input.documentId,
          accessEpoch: input.accessEpoch,
          authorFingerprint: input.authorFingerprint,
          encryptedData: update.encryptedData,
          partialStartVersionVector: update.partialStartVersionVector,
          partialEndVersionVector: update.partialEndVersionVector,
        })),
      )
      .returning({ id: documentUpdates.id });

    acceptedUpdateIds.clear();
    for (const row of [...existingRows, ...insertedRows]) {
      acceptedUpdateIds.add(row.id);
    }
  }

  return input.updates
    .filter((update) => acceptedUpdateIds.has(update.id))
    .map((update) => update.id);
}

function normalizeLinkedContainerIds(linkedContainerIds: string[]): string[] {
  const uniqueLinkedContainerIds = uniqueSortedStrings(linkedContainerIds);

  if (linkedContainerIds.length !== uniqueLinkedContainerIds.length) {
    throw new CreateDocumentError(
      "linkedContainerIds must not contain duplicates",
      400,
    );
  }

  return uniqueLinkedContainerIds;
}

async function loadLinkedContainers(
  executor: DocumentSyncExecutor,
  linkedContainerIds: string[],
): Promise<LinkedContainerRow[]> {
  const linkedContainers = await executor
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(inArray(containers.id, linkedContainerIds));

  if (linkedContainers.length !== linkedContainerIds.length) {
    throw new CreateDocumentError("Linked container not found", 404);
  }

  return linkedContainers;
}

function assertSingleLinkedOrganization(
  linkedContainers: LinkedContainerRow[],
) {
  const organizationIds = uniqueSortedStrings(
    linkedContainers.map((container) => container.organizationId),
  );

  if (organizationIds.length !== 1) {
    throw new CreateDocumentError(
      "All linked containers must belong to the same organization",
      400,
    );
  }
}

async function assertWritableLinkedContainers(input: {
  executor: DocumentSyncExecutor;
  linkedContainers: LinkedContainerRow[];
  userId: string;
}) {
  for (const container of input.linkedContainers) {
    const access = await resolveContainerAccessState(
      container.id,
      input.executor,
    );

    if (!access) {
      throw new CreateDocumentError(
        "Linked container access state is unavailable",
        409,
      );
    }

    if (!canWriteContainerAccess(access, input.userId)) {
      throw new CreateDocumentError("Forbidden", 403);
    }
  }
}

async function insertDocumentWithLinks(input: {
  createdByFingerprint: string;
  executor: DocumentSyncExecutor;
  linkedContainerIds: string[];
}): Promise<DocumentRecord | null> {
  const [document] = await input.executor
    .insert(documents)
    .values({
      createdByFingerprint: input.createdByFingerprint,
    })
    .returning();
  if (!document) {
    return null;
  }

  await input.executor.insert(documentContainerLinks).values(
    input.linkedContainerIds.map((containerId) => ({
      documentId: document.id,
      containerId,
    })),
  );

  return document;
}

async function createInitialDocumentAccess(
  executor: DocumentSyncExecutor,
  document: DocumentRecord,
): Promise<Omit<CreatedDocumentResult, "document"> | null> {
  const currentAccessEpoch = await initializeDocumentAccess(
    document.id,
    executor,
  );
  const access = await resolveDocumentAccessState(document.id, executor);
  if (!access) {
    return null;
  }

  const initialDocumentRecipientEnvelopes =
    await createDocumentRecipientEnvelopes(access);
  if (initialDocumentRecipientEnvelopes) {
    await replaceDocumentRecipientEnvelopes(
      document.id,
      currentAccessEpoch,
      access,
      initialDocumentRecipientEnvelopes,
      executor,
    );
  }

  return {
    currentAccessEpoch,
    documentRecipientEnvelopes: initialDocumentRecipientEnvelopes,
    recipientEncapsulationPublicKeys:
      listRecipientEncapsulationPublicKeys(access),
    referencedPrincipals: access.referencedPrincipals,
  };
}

async function createSyncDocument(
  runtime: ApiServiceRuntime,
  input: CreateDocumentInput,
): ReturnType<DocumentSyncStore["createDocument"]> {
  const linkedContainerIds = normalizeLinkedContainerIds(
    input.linkedContainerIds,
  );

  return runtime.db.transaction(async (tx) => {
    const linkedContainers = await loadLinkedContainers(tx, linkedContainerIds);
    assertSingleLinkedOrganization(linkedContainers);
    await assertWritableLinkedContainers({
      executor: tx,
      linkedContainers,
      userId: input.createdByUserId,
    });

    const document = await insertDocumentWithLinks({
      createdByFingerprint: input.createdByFingerprint,
      executor: tx,
      linkedContainerIds,
    });
    if (!document) {
      return null;
    }

    const access = await createInitialDocumentAccess(tx, document);
    return access ? { document, ...access } : null;
  });
}

async function getSyncDocumentById(
  runtime: ApiServiceRuntime,
  documentId: string,
): Promise<DocumentRecord | null> {
  const [document] = await runtime.db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));
  return document ?? null;
}

async function getSyncDocumentAccess(
  runtime: ApiServiceRuntime,
  input: { documentId: string; userId: string },
): Promise<DocumentAccessState | null> {
  const access = await resolveDocumentAccessState(input.documentId, runtime.db);
  if (!access) {
    return null;
  }
  const documentRecipientEnvelopeAction =
    await getDocumentRecipientEnvelopeAction(
      input.documentId,
      access,
      runtime.db,
    );

  return {
    canRead: canReadDocumentAccess(access, input.userId),
    canWrite: canWriteDocumentAccess(access, input.userId),
    currentAccessEpoch: access.currentAccessEpoch,
    documentRecipientEnvelopeAction,
    documentRecipientEnvelopes: await listDocumentRecipientEnvelopes(
      input.documentId,
      access.currentAccessEpoch,
      runtime.db,
    ),
    rotateBaselineSourceVersionVector:
      documentRecipientEnvelopeAction === "rotate"
        ? await getPriorEpochDocumentVersionVector(
            input.documentId,
            access.currentAccessEpoch,
            runtime.db,
          )
        : null,
    recipientKeyFingerprints: listRecipientKeyFingerprints(access),
    recipientEncapsulationPublicKeys:
      listRecipientEncapsulationPublicKeys(access),
    referencedPrincipals: access.referencedPrincipals,
  };
}

async function appendSyncDocumentUpdates(
  runtime: ApiServiceRuntime,
  input: {
    documentId: string;
    authorFingerprint: string;
    documentRecipientEnvelopes?: SerializedRecipientEnvelope[];
    updates: SyncDocumentOutgoingUpdate[];
  },
): Promise<AppendDocumentUpdatesResult> {
  return runtime.db.transaction(async (tx) => {
    const access = await resolveDocumentAccessState(input.documentId, tx);
    if (!access) {
      throw new DocumentUpdateError("Document access state not found", 409);
    }

    await validateAppendDocumentUpdatesInput({
      access,
      documentId: input.documentId,
      documentRecipientEnvelopes: input.documentRecipientEnvelopes,
      executor: tx,
      updates: input.updates,
    });
    const canonicalDocumentRecipientEnvelopes =
      await putAppendDocumentRecipientEnvelopes({
        access,
        documentId: input.documentId,
        documentRecipientEnvelopes: input.documentRecipientEnvelopes,
        executor: tx,
      });
    const acceptedUpdateIds = await appendMissingDocumentUpdates({
      accessEpoch: access.currentAccessEpoch,
      authorFingerprint: input.authorFingerprint,
      documentId: input.documentId,
      executor: tx,
      updates: input.updates,
    });

    return {
      acceptedOutgoingUpdateIds: acceptedUpdateIds,
      documentRecipientEnvelopes: canonicalDocumentRecipientEnvelopes,
    };
  });
}

async function listSyncDocumentUpdates(
  runtime: ApiServiceRuntime,
  documentId: string,
): Promise<DocumentUpdateRecord[]> {
  return runtime.db
    .select()
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId))
    .orderBy(documentUpdates.sequence);
}

export function createDocumentSyncStore(
  runtime: ApiServiceRuntime,
): DocumentSyncStore {
  return {
    createDocument: (input) => createSyncDocument(runtime, input),
    getDocumentById: (documentId) => getSyncDocumentById(runtime, documentId),
    getDocumentAccess: (input) => getSyncDocumentAccess(runtime, input),
    appendDocumentUpdates: (input) => appendSyncDocumentUpdates(runtime, input),
    listDocumentUpdates: (documentId) =>
      listSyncDocumentUpdates(runtime, documentId),
  };
}
