import { type encodeVersionVector, getTextValue } from "@symcrypt/loro";
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
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import type {
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingUpdateRecord,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
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
// Store-layer teardown-safe writers serialize their generation checks on the
// same mutation mutex the persistence implementations use; the facade
// re-export keeps data internals out of the stores.
export { runSerializedSqlMutation } from "../../data/sqlite/sqlSchema";

type DocumentContentState = Parameters<typeof encodeVersionVector>[0];
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

export async function ensureDocumentClientProjectionTables(input: {
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
      // Content lives in the durable history (checkpoint + tail); the record
      // persists only the content frontier for priming/coverage predicates.
      // A patch that does not advance it RETAINS the stored frontier: deriving
      // from the mutable live document here could publish an in-flight edit's
      // frontier before its durable row lands, so only callers that just made
      // coverage durable (enqueue dual-write, in-mutation tail append, pulled
      // -update append, checkpoint seed) pass the frontier they captured at
      // that moment.
      snapshotEndVersion:
        patch.snapshotEndVersion ?? currentRecord?.snapshotEndVersion ?? "",
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
  // Durable-history tail rows appended inside the same claimed mutation as
  // the record write, before it (see the ordering comment at the call site).
  historyUpdates?: readonly string[] | undefined;
  localId: string;
  patch?: Partial<StoredDocumentRecord> | undefined;
  persistence: DocumentsPersistence;
}

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
    // A persist that expected to UPDATE must never resurrect a canonical row
    // deleted while it waited for this mutation lock. Refuse the whole persist,
    // including history, and clear side writes that queued behind the deletion.
    if (
      currentRecord &&
      !(await persistence.hasDocument(lockedExecSql, localId))
    ) {
      await persistence.deleteDocument(lockedExecSql, localId);
      await documentProjectors.deleteStoredDocumentClientProjection({
        documentKind: currentRecord.documentKind ?? DEFAULT_DOCUMENT_KIND,
        execSql: lockedExecSql,
        localId,
      });
      return null;
    }
    // Append history first: a crash leaves a replayable tail ahead of the
    // frontier, never a published frontier without durable content.
    if (input.historyUpdates && input.historyUpdates.length > 0) {
      await persistence.appendHistoryUpdates(lockedExecSql, {
        localId,
        origin: "local",
        updates: input.historyUpdates,
      });
    }
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
