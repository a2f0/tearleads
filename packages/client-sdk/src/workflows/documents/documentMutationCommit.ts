import { type encodeVersionVector, getTextValue } from "@symcrypt/loro";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../data/documents/documentConstants";
import {
  type DocumentProjectorRegistry,
  type DocumentProjectorRegistryInput,
  readStoredDocumentState,
} from "../../data/documents/documentKinds";
import type {
  DocumentsPersistence,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { PendingUpdateFields } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createInitialDocumentRows } from "./documentCreationPersistence";
import {
  documentSyncSecurityContextMatches,
  type PrepareDocumentMutationInput,
  prepareDocumentMutation,
} from "./documentMutationPreparation";
import { refuseDeletedDocumentPersist } from "./documentPersistGuards";

type DocumentContentState = Parameters<typeof encodeVersionVector>[0];
type NullableDocumentRuntimeField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";

const MAX_DOCUMENT_MUTATION_COMMIT_ATTEMPTS = 8;

export interface PersistedDocumentState {
  creationSuperseded?: true;
  historyRestoreState?:
    | Awaited<ReturnType<DocumentsPersistence["loadHistoryRestoreState"]>>
    | undefined;
  pullContinuationSuperseded?: true;
  record: StoredDocumentRecord;
  syncIdentitySuperseded?: true;
  updatedAt?: string | undefined;
}

export interface PersistDocumentStateInput
  extends PrepareDocumentMutationInput {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  attachmentRemoval?:
    | Parameters<
        DocumentsPersistence["commitDocumentMutation"]
      >[1]["attachmentRemoval"]
    | undefined;
  attachmentStaging?:
    | Parameters<
        DocumentsPersistence["commitDocumentMutation"]
      >[1]["attachmentStaging"]
    | undefined;
  canStartDurableMutation?: (() => boolean) | undefined;
  containerId?: string | null | undefined;
  documentProjectors: DocumentProjectorRegistryInput;
  execSql: ExecSql;
  patch?: Partial<StoredDocumentRecord> | undefined;
  pendingUpdate?: PendingUpdateFields | undefined;
}

async function loadSupersededPersistedDocumentState(input: {
  creationSuperseded: boolean;
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
  record: StoredDocumentRecord;
  syncIdentitySuperseded: boolean;
}): Promise<PersistedDocumentState | null> {
  const { document, historyRestoreState } =
    await input.persistence.loadDocumentWithHistoryRestoreState(
      input.execSql,
      input.localId,
    );
  if (!document) return null;
  const syncIdentitySuperseded =
    input.syncIdentitySuperseded ||
    !documentSyncSecurityContextMatches(document, input.record);
  return {
    ...(input.creationSuperseded ? { creationSuperseded: true as const } : {}),
    historyRestoreState,
    pullContinuationSuperseded: true,
    record: document,
    ...(syncIdentitySuperseded
      ? { syncIdentitySuperseded: true as const }
      : {}),
  };
}

function resolveNullableDocumentRuntimeField(
  patch: Partial<StoredDocumentRecord>,
  key: NullableDocumentRuntimeField,
  currentValue: string | null | undefined,
  resetWhenUnpatched = false,
): string | null {
  if (Object.hasOwn(patch, key)) return patch[key] ?? null;
  return resetWhenUnpatched ? null : (currentValue ?? null);
}

function resolveStoredDocumentContainerId(input: {
  containerId?: string | null | undefined;
  currentRecord: StoredDocumentRecord | null;
  patch: Partial<StoredDocumentRecord>;
}): string | null {
  if (Object.hasOwn(input.patch, "containerId")) {
    return input.patch.containerId ?? null;
  }
  return input.currentRecord?.containerId ?? input.containerId ?? null;
}

function resolveStoredDocumentPullState(input: {
  currentRecord: StoredDocumentRecord | null;
  patch: Partial<StoredDocumentRecord>;
  securityContextChanged: boolean;
}): Pick<
  StoredDocumentRecord,
  "pullContinuation" | "pullContinuationRecoveryRequired"
> {
  if (Object.hasOwn(input.patch, "pullContinuation")) {
    return { pullContinuation: input.patch.pullContinuation ?? null };
  }
  if (input.securityContextChanged) return { pullContinuation: null };
  if (input.currentRecord?.pullContinuationRecoveryRequired) {
    return { pullContinuationRecoveryRequired: true };
  }
  return { pullContinuation: input.currentRecord?.pullContinuation ?? null };
}

function buildStoredDocumentRecord(input: {
  containerId?: string | null | undefined;
  currentDoc: DocumentContentState;
  currentRecord: StoredDocumentRecord | null;
  documentProjectors: DocumentProjectorRegistry;
  localId: string;
  patch: Partial<StoredDocumentRecord>;
}) {
  const { currentDoc, currentRecord, documentProjectors, localId, patch } =
    input;
  const currentDocumentId = currentRecord?.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const documentIdChanged = nextDocumentId !== currentDocumentId;
  const currentAccessEpoch =
    currentRecord?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH;
  const nextAccessEpoch = patch.accessEpoch ?? currentAccessEpoch;
  const securityContextChanged =
    documentIdChanged || nextAccessEpoch !== currentAccessEpoch;
  const documentState = readStoredDocumentState(currentDoc, documentProjectors);
  const record: StoredDocumentRecord = {
    id: currentRecord?.id ?? localId,
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolveNullableDocumentRuntimeField(
      patch,
      "accessStateHash",
      currentRecord?.accessStateHash,
      securityContextChanged,
    ),
    containerId: resolveStoredDocumentContainerId({
      containerId: input.containerId,
      currentRecord,
      patch,
    }),
    contentKeyBundle: resolveNullableDocumentRuntimeField(
      patch,
      "contentKeyBundle",
      currentRecord?.contentKeyBundle,
      securityContextChanged,
    ),
    documentId: nextDocumentId,
    effectiveAccessLevel:
      patch.effectiveAccessLevel ?? currentRecord?.effectiveAccessLevel ?? null,
    documentKekTargets: resolveNullableDocumentRuntimeField(
      patch,
      "documentKekTargets",
      currentRecord?.documentKekTargets,
      securityContextChanged,
    ),
    documentKind: patch.documentKind ?? documentState.documentKind,
    documentManifestBundle: resolveNullableDocumentRuntimeField(
      patch,
      "documentManifestBundle",
      currentRecord?.documentManifestBundle,
      securityContextChanged,
    ),
    lastCommitLsn: resolveNullableDocumentRuntimeField(
      patch,
      "lastCommitLsn",
      currentRecord?.lastCommitLsn,
      documentIdChanged,
    ),
    snapshotEndVersion:
      patch.snapshotEndVersion ?? currentRecord?.snapshotEndVersion ?? "",
    pendingBaseVersion:
      patch.pendingBaseVersion !== undefined
        ? patch.pendingBaseVersion
        : (currentRecord?.pendingBaseVersion ?? null),
    ...resolveStoredDocumentPullState({
      currentRecord,
      patch,
      securityContextChanged,
    }),
    text: patch.text ?? getTextValue(currentDoc),
    title: patch.title ?? documentState.title,
  };
  return { documentState, record };
}

async function saveDocumentClientProjection(input: {
  currentRecord: StoredDocumentRecord | null;
  documentProjectors: DocumentProjectorRegistry;
  documentState: ReturnType<typeof readStoredDocumentState>;
  execSql: ExecSql;
  localId: string;
  record: StoredDocumentRecord;
  updatedAt: string;
}): Promise<void> {
  const previousKind =
    input.currentRecord?.documentKind ?? DEFAULT_DOCUMENT_KIND;
  const nextKind = input.record.documentKind ?? DEFAULT_DOCUMENT_KIND;
  if (previousKind !== nextKind) {
    await input.documentProjectors.deleteStoredDocumentClientProjection({
      documentKind: previousKind,
      execSql: input.execSql,
      localId: input.localId,
    });
  }
  await input.documentProjectors.saveStoredDocumentClientProjection({
    containerId: input.record.containerId,
    documentId: input.record.documentId,
    documentKind: nextKind,
    execSql: input.execSql,
    localId: input.record.id,
    structuredFields: input.documentState.structuredFields,
    text: input.record.text,
    title: input.record.title ?? input.documentState.title,
    updatedAt: input.updatedAt,
  });
}

async function settleSupersededDocumentMutation(input: {
  acceptedPendingUpdateIds: readonly string[];
  lockedExecSql: ExecSql;
  mutation: Awaited<ReturnType<typeof prepareDocumentMutation>>;
  persistInput: PersistDocumentStateInput;
}): Promise<PersistedDocumentState | null> {
  const { mutation, persistInput } = input;
  if (!mutation.mutationCurrentRecord) return null;
  const authoritativeRecord = persistInput.expectedSyncState
    ? await persistInput.persistence.settleAcceptedPendingUpdates(
        input.lockedExecSql,
        {
          expectedRecord: persistInput.expectedSyncState.record,
          pendingUpdateIds: input.acceptedPendingUpdateIds,
        },
      )
    : mutation.mutationCurrentRecord;
  if (!authoritativeRecord) return null;
  return loadSupersededPersistedDocumentState({
    creationSuperseded: mutation.creationSuperseded,
    execSql: input.lockedExecSql,
    localId: persistInput.localId,
    persistence: persistInput.persistence,
    record: authoritativeRecord,
    syncIdentitySuperseded: !mutation.securityContextMatches,
  });
}

async function loadConcurrentCreationWinner(input: {
  execSql: ExecSql;
  persistInput: PersistDocumentStateInput;
}): Promise<PersistedDocumentState> {
  const winningRecord = await input.persistInput.persistence.loadDocument(
    input.execSql,
    input.persistInput.localId,
  );
  if (!winningRecord) {
    throw new Error("Concurrent document creation lost without a winner");
  }
  const winner = await loadSupersededPersistedDocumentState({
    creationSuperseded: true,
    execSql: input.execSql,
    localId: input.persistInput.localId,
    persistence: input.persistInput.persistence,
    record: winningRecord,
    syncIdentitySuperseded: true,
  });
  if (!winner) {
    throw new Error("Concurrent document creation winner disappeared");
  }
  return winner;
}

async function resolveInitialDocumentCreation(input: {
  execSql: ExecSql;
  persistInput: PersistDocumentStateInput;
  record: StoredDocumentRecord;
  savedAt: string | null;
}): Promise<PersistedDocumentState | null> {
  if (input.savedAt !== null) {
    return { record: input.record, updatedAt: input.savedAt };
  }
  if (
    input.persistInput.canStartDurableMutation &&
    !input.persistInput.canStartDurableMutation()
  ) {
    return null;
  }
  return loadConcurrentCreationWinner({
    execSql: input.execSql,
    persistInput: input.persistInput,
  });
}

async function resolveDocumentMutationCommit(input: {
  committed: Awaited<
    ReturnType<DocumentsPersistence["commitDocumentMutation"]>
  >;
  lockedExecSql: ExecSql;
  persistInput: PersistDocumentStateInput;
  record: StoredDocumentRecord;
}): Promise<PersistedDocumentState | null | "retry"> {
  const { committed, persistInput, record } = input;
  if (
    persistInput.canStartDurableMutation &&
    !persistInput.canStartDurableMutation()
  ) {
    return null;
  }
  if (committed.committed) return { record, updatedAt: committed.updatedAt };
  if (!committed.currentRecord) return null;
  if (persistInput.expectedSyncState === undefined) return "retry";
  return loadSupersededPersistedDocumentState({
    creationSuperseded: false,
    execSql: input.lockedExecSql,
    localId: persistInput.localId,
    persistence: persistInput.persistence,
    record: committed.currentRecord,
    syncIdentitySuperseded: !documentSyncSecurityContextMatches(
      committed.currentRecord,
      persistInput.expectedSyncState.record,
    ),
  });
}

async function commitOnePreparedDocumentMutation(input: {
  acceptedPendingUpdateIds: readonly string[];
  documentProjectors: DocumentProjectorRegistry;
  lockedExecSql: ExecSql;
  mutation: Exclude<
    Awaited<ReturnType<typeof prepareDocumentMutation>>,
    { pullContinuationSuperseded: true }
  >;
  persistInput: PersistDocumentStateInput;
}): Promise<PersistedDocumentState | null | "retry"> {
  const { mutation, persistInput } = input;
  const { documentState, record } = buildStoredDocumentRecord({
    containerId: persistInput.containerId,
    currentDoc: persistInput.currentDoc,
    currentRecord: mutation.mutationCurrentRecord,
    documentProjectors: input.documentProjectors,
    localId: persistInput.localId,
    patch: mutation.resolvedPatch,
  });
  if (!mutation.mutationCurrentRecord) {
    const savedAt = await createInitialDocumentRows({
      currentDoc: persistInput.currentDoc,
      execSql: input.lockedExecSql,
      pendingUpdate: persistInput.pendingUpdate,
      persistence: persistInput.persistence,
      record,
      stillCurrent: persistInput.canStartDurableMutation,
      saveClientProjection: (transactionExecSql, updatedAt) =>
        saveDocumentClientProjection({
          currentRecord: null,
          documentProjectors: input.documentProjectors,
          documentState,
          execSql: transactionExecSql,
          localId: persistInput.localId,
          record,
          updatedAt,
        }),
    });
    return resolveInitialDocumentCreation({
      execSql: input.lockedExecSql,
      persistInput,
      record,
      savedAt,
    });
  }

  const committed = await persistInput.persistence.commitDocumentMutation(
    input.lockedExecSql,
    {
      acceptedPendingUpdateIds: input.acceptedPendingUpdateIds,
      ...(persistInput.attachmentRemoval
        ? { attachmentRemoval: persistInput.attachmentRemoval }
        : {}),
      ...(persistInput.attachmentStaging
        ? { attachmentStaging: persistInput.attachmentStaging }
        : {}),
      document: record,
      expectedRecord: mutation.mutationCurrentRecord,
      ...(persistInput.historyCheckpoint
        ? { historyCheckpoint: persistInput.historyCheckpoint }
        : {}),
      ...(persistInput.historyUpdateOrigin
        ? { historyUpdateOrigin: persistInput.historyUpdateOrigin }
        : {}),
      ...(persistInput.historyUpdates
        ? { historyUpdates: persistInput.historyUpdates }
        : {}),
      ...(persistInput.pendingUpdate
        ? { pendingUpdate: persistInput.pendingUpdate }
        : {}),
      settleAcceptedPendingOnConflict:
        persistInput.expectedSyncState !== undefined,
      ...(persistInput.canStartDurableMutation
        ? { stillCurrent: persistInput.canStartDurableMutation }
        : {}),
    },
    (transactionExecSql, updatedAt) =>
      saveDocumentClientProjection({
        currentRecord: mutation.mutationCurrentRecord,
        documentProjectors: input.documentProjectors,
        documentState,
        execSql: transactionExecSql,
        localId: persistInput.localId,
        record,
        updatedAt,
      }),
  );
  return resolveDocumentMutationCommit({
    committed,
    lockedExecSql: input.lockedExecSql,
    persistInput,
    record,
  });
}

export async function commitPreparedDocumentState(input: {
  documentProjectors: DocumentProjectorRegistry;
  lockedExecSql: ExecSql;
  patch: Partial<StoredDocumentRecord>;
  persistInput: PersistDocumentStateInput;
}): Promise<PersistedDocumentState | null> {
  const { lockedExecSql, persistInput } = input;
  if (
    await refuseDeletedDocumentPersist({
      currentRecord: persistInput.currentRecord,
      documentProjectors: input.documentProjectors,
      execSql: lockedExecSql,
      localId: persistInput.localId,
      persistence: persistInput.persistence,
    })
  ) {
    return null;
  }
  const acceptedPendingUpdateIds = persistInput.acceptedPendingUpdateIds ?? [];
  for (
    let attempt = 0;
    attempt < MAX_DOCUMENT_MUTATION_COMMIT_ATTEMPTS;
    attempt += 1
  ) {
    const mutation = await prepareDocumentMutation(
      persistInput,
      lockedExecSql,
      input.patch,
    );
    if (mutation.pullContinuationSuperseded) {
      return settleSupersededDocumentMutation({
        acceptedPendingUpdateIds,
        lockedExecSql,
        mutation,
        persistInput,
      });
    }
    const result = await commitOnePreparedDocumentMutation({
      acceptedPendingUpdateIds,
      documentProjectors: input.documentProjectors,
      lockedExecSql,
      mutation,
      persistInput,
    });
    if (result !== "retry") return result;
  }
  throw new Error(
    `Document mutation commit gave up after ${MAX_DOCUMENT_MUTATION_COMMIT_ATTEMPTS} concurrent conflicts`,
  );
}
