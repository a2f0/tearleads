import { bytesToBase64 } from "@tearleads/encoding";
import { exportShallowSnapshot, getTextValue } from "@tearleads/loro";
import { createPendingUpdateFields } from "../../data/documentSync";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../data/documents/documentConstants";
import {
  type DocumentProjectorRegistry,
  type DocumentProjectorRegistryInput,
  readStoredDocumentState,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import {
  DOCUMENTS_APP_KIND,
  type DocumentsPersistence,
  type LocalAttachmentRecord,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
  type StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import { deleteDocumentHistory } from "../../data/sqlite/documentHistoryPersistence";
import { clearDocumentSyncFailure } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";

export type {
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingAttachmentUploadIdentity,
  PendingUpdateInsert,
  PendingUpdateRecord,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord as DocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
export {
  DOCUMENTS_APP_KIND,
  sqlDocumentsPersistence as defaultDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";

type DocumentContentState = Parameters<typeof exportShallowSnapshot>[0];
type NullableDocumentRuntimeField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";

const projectionSchemaEnsuresByExecSql = new WeakMap<
  ExecSql,
  WeakMap<DocumentProjectorRegistry, Promise<void>>
>();

interface PersistedDocumentState {
  record: StoredDocumentRecord;
  updatedAt: string;
}

interface BuiltStoredDocumentRecord {
  documentState: ReturnType<typeof readStoredDocumentState>;
  record: StoredDocumentRecord;
}

interface LoadedPersistedDocumentStoreState {
  document: StoredDocumentRecord | null;
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
}

async function ensureDocumentClientProjectionTables(input: {
  documentProjectors: DocumentProjectorRegistry;
  execSql: ExecSql;
}): Promise<void> {
  let ensuresByProjector = projectionSchemaEnsuresByExecSql.get(input.execSql);
  if (!ensuresByProjector) {
    ensuresByProjector = new WeakMap();
    projectionSchemaEnsuresByExecSql.set(input.execSql, ensuresByProjector);
  }

  const existingEnsure = ensuresByProjector.get(input.documentProjectors);
  if (existingEnsure) {
    await existingEnsure;
    return;
  }

  const tables = input.documentProjectors.getClientProjectionTables();
  if (tables.length === 0) {
    ensuresByProjector.set(input.documentProjectors, Promise.resolve());
    return;
  }

  const ensurePromise = ensureSqlTables(input.execSql, tables).catch(
    (error: unknown) => {
      ensuresByProjector.delete(input.documentProjectors);
      throw error;
    },
  );
  ensuresByProjector.set(input.documentProjectors, ensurePromise);
  await ensurePromise;
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

function patchSpecifiesContainer(
  patch: Partial<StoredDocumentRecord>,
): boolean {
  // A patch "specifies" a container when it carries the key with a concrete
  // value: a string, or an explicit null meaning "unlinked from every container".
  // `exactOptionalPropertyTypes` is enabled repo-wide, so an owned containerId key
  // is always concrete — a patch may omit the key but cannot set it to `undefined`
  // (that is a compile error). Key presence therefore reliably distinguishes a
  // write that specifies a container from one that defers to the authoritative
  // projection; no explicit `!== undefined` guard is needed.
  return Object.hasOwn(patch, "containerId");
}

function resolveStoredDocumentContainerId(input: {
  containerId?: string | null | undefined;
  currentRecord: StoredDocumentRecord | null;
  patch: Partial<StoredDocumentRecord>;
}): string | null {
  // Container placement is owned by the link/tombstone/discovery layer, not by
  // this content-metadata persist. An explicitly-supplied container is
  // authoritative — whether it comes from a create/relink patch or from the
  // authoritative document_projection value persistDocumentState injects for a
  // sync that does not manage a container. Honoring a specified container (even
  // an explicit null, a document unlinked from every container) keeps a write
  // from falling through to a stale cached container and resurrecting the
  // document in a folder the reconcile layer already moved it out of. Only a
  // write that specifies no container, and for which no projection row exists
  // yet, falls back to the in-memory record and then the runtime container.
  if (patchSpecifiesContainer(input.patch)) {
    return input.patch.containerId ?? null;
  }

  return input.currentRecord?.containerId ?? input.containerId ?? null;
}

function buildStoredDocumentRecord(input: {
  containerId?: string | null | undefined;
  currentDoc: DocumentContentState;
  currentRecord: StoredDocumentRecord | null;
  documentProjectors: DocumentProjectorRegistry;
  localId: string;
  patch: Partial<StoredDocumentRecord>;
}): BuiltStoredDocumentRecord {
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

  return {
    documentState,
    record: {
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
        patch.effectiveAccessLevel ??
        currentRecord?.effectiveAccessLevel ??
        null,
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
      loroSnapshot:
        patch.loroSnapshot ?? bytesToBase64(exportShallowSnapshot(currentDoc)),
      // Carry the outgoing-delta marker the store injects into the patch, so it
      // is persisted alongside the snapshot it describes. A patched value is
      // authoritative (including an explicit null); only an absent key falls
      // back to the existing marker, so a caller that does not manage the marker
      // never drops it.
      pendingBaseVersion:
        patch.pendingBaseVersion !== undefined
          ? patch.pendingBaseVersion
          : (currentRecord?.pendingBaseVersion ?? null),
      text: patch.text ?? getTextValue(currentDoc),
      title: patch.title ?? documentState.title,
    },
  };
}

async function saveDocumentRecord(input: {
  acceptedPendingUpdateIds: readonly string[];
  execSql: ExecSql;
  persistence: DocumentsPersistence;
  record: StoredDocumentRecord;
}): Promise<string> {
  if (input.acceptedPendingUpdateIds.length > 0) {
    return input.persistence.saveDocumentAndDeletePendingUpdates(
      input.execSql,
      input.record,
      input.acceptedPendingUpdateIds,
    );
  }

  return input.persistence.saveDocument(input.execSql, input.record);
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
  const previousDocumentKind =
    input.currentRecord?.documentKind ?? DEFAULT_DOCUMENT_KIND;
  const nextDocumentKind = input.record.documentKind ?? DEFAULT_DOCUMENT_KIND;
  if (previousDocumentKind !== nextDocumentKind) {
    await input.documentProjectors.deleteStoredDocumentClientProjection({
      documentKind: previousDocumentKind,
      execSql: input.execSql,
      localId: input.localId,
    });
  }

  await input.documentProjectors.saveStoredDocumentClientProjection({
    containerId: input.record.containerId,
    documentId: input.record.documentId,
    documentKind: nextDocumentKind,
    execSql: input.execSql,
    localId: input.record.id,
    structuredFields: input.documentState.structuredFields,
    text: input.record.text,
    title: input.record.title ?? input.documentState.title,
    updatedAt: input.updatedAt,
  });
}

interface PersistDocumentStateInput {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  canStartDurableMutation?: (() => boolean) | undefined;
  containerId?: string | null | undefined;
  currentDoc: DocumentContentState;
  currentRecord: StoredDocumentRecord | null;
  documentProjectors: DocumentProjectorRegistryInput;
  execSql: ExecSql;
  localId: string;
  patch?: Partial<StoredDocumentRecord> | undefined;
  persistence: DocumentsPersistence;
}

export function persistDocumentState(
  input: PersistDocumentStateInput & {
    canStartDurableMutation: () => boolean;
  },
): Promise<PersistedDocumentState | null>;
export function persistDocumentState(
  input: PersistDocumentStateInput,
): Promise<PersistedDocumentState>;
export async function persistDocumentState(
  input: PersistDocumentStateInput,
): Promise<PersistedDocumentState | null> {
  const { currentDoc, currentRecord, execSql, localId, persistence } = input;
  const documentProjectors = resolveDocumentProjectorRegistry(
    input.documentProjectors,
  );
  const patch = input.patch ?? {};
  const acceptedPendingUpdateIds = input.acceptedPendingUpdateIds ?? [];

  await ensureDocumentClientProjectionTables({ documentProjectors, execSql });
  // This check is intentionally adjacent to the serialized mutation claim.
  // Earlier awaits may let a store reset/reinitialize; once the call below
  // starts, same-executor replacement writes queue behind this operation.
  if (input.canStartDurableMutation && !input.canStartDurableMutation()) {
    return null;
  }

  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    // A persist that does not manage container placement (a background
    // document sync ships content-key/manifest metadata with no container)
    // must not let an in-memory record re-assert a stale container. Read the
    // authoritative placement and build the complete row only after claiming
    // the mutation queue, so a concurrent local/deferred edit cannot commit a
    // newer snapshot and then be overwritten by this prebuilt row.
    const authoritativeContainer = patchSpecifiesContainer(patch)
      ? undefined
      : await persistence.loadDocumentContainer(lockedExecSql, localId);
    const resolvedPatch =
      authoritativeContainer === undefined
        ? patch
        : { ...patch, containerId: authoritativeContainer.containerId };
    const { documentState, record } = buildStoredDocumentRecord({
      containerId: input.containerId,
      currentDoc,
      currentRecord,
      documentProjectors,
      localId,
      patch: resolvedPatch,
    });
    const savedAt = await saveDocumentRecord({
      acceptedPendingUpdateIds,
      execSql: lockedExecSql,
      persistence,
      record,
    });
    await saveDocumentClientProjection({
      currentRecord,
      documentProjectors,
      documentState,
      execSql: lockedExecSql,
      localId,
      record,
      updatedAt: savedAt,
    });
    return { record, updatedAt: savedAt };
  });
}

export async function loadPersistedDocumentStoreState(input: {
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

export async function deletePersistedDocument(input: {
  canStartDurableMutation?: (() => boolean) | undefined;
  documentProjectors: DocumentProjectorRegistryInput;
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<boolean> {
  const documentProjectors = resolveDocumentProjectorRegistry(
    input.documentProjectors,
  );
  await input.persistence.ensureSchema(input.execSql);
  await ensureDocumentClientProjectionTables({
    documentProjectors,
    execSql: input.execSql,
  });
  if (input.canStartDurableMutation && !input.canStartDurableMutation()) {
    return false;
  }

  await runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    const existing = await input.persistence.loadDocument(
      lockedExecSql,
      input.localId,
    );
    await input.persistence.deleteDocument(lockedExecSql, input.localId);
    await documentProjectors.deleteStoredDocumentClientProjection({
      documentKind: existing?.documentKind ?? DEFAULT_DOCUMENT_KIND,
      execSql: lockedExecSql,
      localId: input.localId,
    });
  });
  return true;
}

export type DiscardedDocumentShellResult =
  | { discarded: false }
  | { discarded: true; stagedAttachmentStorageKeys: ReadonlyArray<string> };

/**
 * Convert a stuck document's local state to the freshly-discovered-share
 * shell IN PLACE: drop the queued updates, staged attachment rows, durable
 * history, and recorded sync failure, then overwrite the record with an
 * empty snapshot that keeps its identity, placement, title, and kind. The
 * record row is never absent at any point — the only record write is an
 * upsert over the existing row — so an interruption at any step leaves a
 * loadable document (old or shell) rather than a vanished one, and the
 * projection and container-link rows are never touched at all.
 *
 * Refused inside the serialized mutation when the document is local-only or
 * unlinked (its rows are the only copy) or when a move intent is queued: the
 * local containerId is then the move's optimistic placement, and reseeding
 * it as if it were server truth would silently commit the move locally
 * while discarding the intent that was meant to perform it.
 *
 * Returns the staged uploads' storage keys on success — their rows were the
 * only durable pointer to the staged bytes, so the caller reclaims them.
 */
export async function discardPersistedDocumentToShell(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<DiscardedDocumentShellResult> {
  await input.persistence.ensureSchema(input.execSql);
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    const record = await input.persistence.loadDocument(
      lockedExecSql,
      input.localId,
    );
    if (!record?.documentId || !record.containerId) {
      return { discarded: false };
    }
    if (
      await sqlDocumentMoveIntentPersistence.hasMoveIntentForLocalId(
        lockedExecSql,
        input.localId,
      )
    ) {
      return { discarded: false };
    }

    const pendingAttachments = await input.persistence.listPendingAttachments(
      lockedExecSql,
      input.localId,
    );
    await input.persistence.deletePendingUpdates(lockedExecSql, input.localId);
    await input.persistence.deletePendingAttachments(
      lockedExecSql,
      input.localId,
    );
    await deleteDocumentHistory(lockedExecSql, {
      appKind: DOCUMENTS_APP_KIND,
      localId: input.localId,
    });
    await clearDocumentSyncFailure(lockedExecSql, {
      appKind: DOCUMENTS_APP_KIND,
      localId: input.localId,
    });
    await input.persistence.saveDocument(lockedExecSql, {
      id: input.localId,
      accessEpoch: record.accessEpoch,
      accessStateHash: record.accessStateHash ?? null,
      containerId: record.containerId,
      contentKeyBundle: null,
      documentId: record.documentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      effectiveAccessLevel: record.effectiveAccessLevel ?? null,
      lastCommitLsn: null,
      loroSnapshot: "",
      pendingBaseVersion: null,
      text: "",
      ...(record.documentKind === undefined
        ? {}
        : { documentKind: record.documentKind }),
      ...(record.title === undefined ? {} : { title: record.title }),
    });
    return {
      discarded: true,
      stagedAttachmentStorageKeys: pendingAttachments.map(
        (pendingAttachment) => pendingAttachment.storageKey,
      ),
    };
  });
}

export async function listPendingDocumentUpdates(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<PendingUpdateRecord[]> {
  return input.persistence.listPendingUpdates(input.execSql, input.localId);
}

export async function enqueuePendingDocumentUpdate(input: {
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
