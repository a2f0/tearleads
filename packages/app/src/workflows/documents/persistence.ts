import { bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates, getTextValue } from "@tearleads/loro";
import { createPendingUpdateFields } from "../../data/documentSync";
import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../data/documents/documentConstants";
import type {
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingUpdateRecord,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export type {
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingUpdateRecord,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord as DocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
export {
  DOCUMENTS_APP_KIND,
  deriveDocumentKind,
  deriveDocumentTitle,
  sqlDocumentsPersistence as defaultDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";

type DocumentContentState = Parameters<typeof exportAllUpdates>[0];
type DocumentLocalStateRuntime = {
  execSql: ExecSql;
};
type NullableDocumentRuntimeField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";

interface PersistedDocumentState {
  record: StoredDocumentRecord;
  updatedAt: string;
}

interface LoadedPersistedDocumentStoreState {
  document: StoredDocumentRecord | null;
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
}

function resolveNullableDocumentRuntimeField(
  patch: Partial<StoredDocumentRecord>,
  key: NullableDocumentRuntimeField,
  currentValue: string | null | undefined,
  resetWhenUnpatched = false,
): string | null {
  if (Object.hasOwn(patch, key)) {
    return patch[key] ?? null;
  }

  return resetWhenUnpatched ? null : (currentValue ?? null);
}

async function persistDocumentState(input: {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  containerId?: string | null | undefined;
  currentDoc: DocumentContentState;
  currentRecord: StoredDocumentRecord | null;
  execSql: ExecSql;
  localId: string;
  patch?: Partial<StoredDocumentRecord> | undefined;
  persistence: DocumentsPersistence;
}): Promise<PersistedDocumentState> {
  const { currentDoc, currentRecord, execSql, localId, persistence } = input;
  const patch = input.patch ?? {};
  const acceptedPendingUpdateIds = input.acceptedPendingUpdateIds ?? [];
  const currentDocumentId = currentRecord?.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const documentIdChanged = nextDocumentId !== currentDocumentId;
  const currentAccessEpoch =
    currentRecord?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH;
  const nextAccessEpoch = patch.accessEpoch ?? currentAccessEpoch;
  const securityContextChanged =
    documentIdChanged || nextAccessEpoch !== currentAccessEpoch;
  const nextRecord: StoredDocumentRecord = {
    id: currentRecord?.id ?? localId,
    containerId:
      patch.containerId ??
      currentRecord?.containerId ??
      input.containerId ??
      null,
    documentId: nextDocumentId,
    text: patch.text ?? getTextValue(currentDoc),
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(currentDoc)),
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolveNullableDocumentRuntimeField(
      patch,
      "accessStateHash",
      currentRecord?.accessStateHash,
      securityContextChanged,
    ),
    lastCommitLsn: resolveNullableDocumentRuntimeField(
      patch,
      "lastCommitLsn",
      currentRecord?.lastCommitLsn,
      documentIdChanged,
    ),
    contentKeyBundle: resolveNullableDocumentRuntimeField(
      patch,
      "contentKeyBundle",
      currentRecord?.contentKeyBundle,
      securityContextChanged,
    ),
    documentKekTargets: resolveNullableDocumentRuntimeField(
      patch,
      "documentKekTargets",
      currentRecord?.documentKekTargets,
      securityContextChanged,
    ),
    documentManifestBundle: resolveNullableDocumentRuntimeField(
      patch,
      "documentManifestBundle",
      currentRecord?.documentManifestBundle,
      securityContextChanged,
    ),
  };

  const updatedAt =
    acceptedPendingUpdateIds.length > 0
      ? await persistence.saveDocumentAndDeletePendingUpdates(
          execSql,
          nextRecord,
          acceptedPendingUpdateIds,
        )
      : await persistence.saveDocument(execSql, nextRecord);

  return {
    record: nextRecord,
    updatedAt,
  };
}

export async function persistDocumentStateFromRuntime({
  runtime,
  ...input
}: {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  containerId?: string | null | undefined;
  currentDoc: DocumentContentState;
  currentRecord: StoredDocumentRecord | null;
  localId: string;
  patch?: Partial<StoredDocumentRecord> | undefined;
  persistence: DocumentsPersistence;
  runtime: DocumentLocalStateRuntime;
}): Promise<PersistedDocumentState> {
  return persistDocumentState({
    ...input,
    execSql: runtime.execSql,
  });
}

async function loadPersistedDocumentStoreState(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<LoadedPersistedDocumentStoreState> {
  const { execSql, localId, persistence } = input;
  await persistence.ensureSchema(execSql);
  const [document, pendingAttachments, localAttachments] = await Promise.all([
    persistence.loadDocument(execSql, localId),
    persistence.listPendingAttachments(execSql, localId),
    persistence.listLocalAttachments(execSql, localId),
  ]);

  return {
    document,
    localAttachments,
    pendingAttachments,
  };
}

export async function loadPersistedDocumentStoreStateFromRuntime({
  runtime,
  ...input
}: {
  localId: string;
  persistence: DocumentsPersistence;
  runtime: DocumentLocalStateRuntime;
}): Promise<LoadedPersistedDocumentStoreState> {
  return loadPersistedDocumentStoreState({
    ...input,
    execSql: runtime.execSql,
  });
}

async function listPendingDocumentUpdates(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<PendingUpdateRecord[]> {
  return input.persistence.listPendingUpdates(input.execSql, input.localId);
}

export async function listPendingDocumentUpdatesFromRuntime({
  runtime,
  ...input
}: {
  localId: string;
  persistence: DocumentsPersistence;
  runtime: DocumentLocalStateRuntime;
}): Promise<PendingUpdateRecord[]> {
  return listPendingDocumentUpdates({
    ...input,
    execSql: runtime.execSql,
  });
}

async function enqueuePendingDocumentUpdate(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
  sourceVersionVector?: string | null;
  update: Uint8Array;
}): Promise<void> {
  const pendingUpdateFields = createPendingUpdateFields(
    input.update,
    input.sourceVersionVector,
  );
  if (!pendingUpdateFields) {
    return;
  }

  await input.persistence.enqueuePendingUpdate(input.execSql, {
    localId: input.localId,
    ...pendingUpdateFields,
  });
}

export async function enqueuePendingDocumentUpdateFromRuntime({
  runtime,
  ...input
}: {
  localId: string;
  persistence: DocumentsPersistence;
  runtime: DocumentLocalStateRuntime;
  sourceVersionVector?: string | null;
  update: Uint8Array;
}): Promise<void> {
  return enqueuePendingDocumentUpdate({
    ...input,
    execSql: runtime.execSql,
  });
}

async function saveLocalDocumentAttachments(input: {
  attachments: ReadonlyArray<LocalAttachmentRecord>;
  execSql: ExecSql;
  persistence: DocumentsPersistence;
}): Promise<void> {
  for (const attachment of input.attachments) {
    await input.persistence.saveLocalAttachment(input.execSql, attachment);
  }
}

export async function saveLocalDocumentAttachmentsFromRuntime({
  runtime,
  ...input
}: {
  attachments: ReadonlyArray<LocalAttachmentRecord>;
  persistence: DocumentsPersistence;
  runtime: DocumentLocalStateRuntime;
}): Promise<void> {
  return saveLocalDocumentAttachments({
    ...input,
    execSql: runtime.execSql,
  });
}

async function savePendingDocumentAttachment(input: {
  attachment: PendingAttachmentRecord;
  execSql: ExecSql;
  persistence: DocumentsPersistence;
}): Promise<void> {
  await input.persistence.savePendingAttachment(
    input.execSql,
    input.attachment,
  );
}

export async function savePendingDocumentAttachmentFromRuntime({
  runtime,
  ...input
}: {
  attachment: PendingAttachmentRecord;
  persistence: DocumentsPersistence;
  runtime: DocumentLocalStateRuntime;
}): Promise<void> {
  return savePendingDocumentAttachment({
    ...input,
    execSql: runtime.execSql,
  });
}

async function deletePendingDocumentAttachment(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
  slotId: string;
  storageKey: string;
}): Promise<void> {
  await input.persistence.deletePendingAttachment(
    input.execSql,
    input.localId,
    input.slotId,
    input.storageKey,
  );
}

export async function deletePendingDocumentAttachmentFromRuntime({
  runtime,
  ...input
}: {
  localId: string;
  persistence: DocumentsPersistence;
  runtime: DocumentLocalStateRuntime;
  slotId: string;
  storageKey: string;
}): Promise<void> {
  return deletePendingDocumentAttachment({
    ...input,
    execSql: runtime.execSql,
  });
}
