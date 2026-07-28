import { deriveStableDocumentId } from "../../../data/documents/shared/stableDocumentId";
import {
  createRemoteDocument,
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  describeDocumentRevalidationFailure,
  describeDocumentSyncSubmitFailure,
  type PendingUpdateRecord,
  recordDocumentSyncFailure,
  resolveDocumentCreateAuthor,
  runSerializedSqlMutation,
} from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { chainIdentityWrite } from "./identityWriteChain";
import { persistDocument } from "./persistence";
import type {
  DocumentState,
  DocumentStoreState,
  EncapsulationKeyPair,
} from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

/**
 * Record a refused read-only revalidation on this document's failure row, so
 * a document that can never refresh stops failing silently (edge-case row
 * 13). 403s stay suppressed on purpose — a read-only 403 must never flag
 * unattempted local edits (row 9) — and the row clears on the next clean
 * pass like every other sync failure.
 */
export function documentRevalidationFailureHandler(
  state: DocumentStoreState,
  generation?: DocumentStoreSyncGeneration,
) {
  return async (failure: {
    readonly message: string;
    readonly status: number | null;
  }) => {
    if (failure.status === 403) {
      return;
    }

    // The generation recheck runs INSIDE the serialized mutation (like the
    // attachment failure path): a teardown (discard/reset) that wins the
    // ordering deletes this document's rows first and invalidates the
    // generation, so a stale handler can never resurrect an orphan
    // failure-only queue row afterwards.
    await runSerializedSqlMutation(
      generation?.execSql ?? state.runtime.infra.execSql,
      async (lockedExecSql) => {
        if (
          generation &&
          !isDocumentStoreSyncGenerationCurrent(state, generation)
        ) {
          return;
        }
        await recordDocumentSyncFailure(
          lockedExecSql,
          { appKind: DOCUMENTS_APP_KIND, localId: state.localId },
          {
            attemptedAt: new Date().toISOString(),
            message: describeDocumentRevalidationFailure(failure),
            status: failure.status,
          },
        );
      },
    );
  };
}

/**
 * Record a terminal submit failure on this document's write-queue row. Shared
 * by every store pass that can submit (create, sync, rotation preflight), so
 * re-key exhaustion and denial failures surface no matter which pass hits
 * them first.
 */
export function documentTerminalSubmitFailureHandler(
  state: DocumentStoreState,
  generation?: DocumentStoreSyncGeneration,
) {
  return async (failure: {
    readonly message: string;
    readonly status: number | null;
  }) => {
    if (
      generation &&
      !isDocumentStoreSyncGenerationCurrent(state, generation)
    ) {
      return;
    }

    await recordDocumentSyncFailure(
      generation?.execSql ?? state.runtime.infra.execSql,
      { appKind: DOCUMENTS_APP_KIND, localId: state.localId },
      {
        attemptedAt: new Date().toISOString(),
        message: describeDocumentSyncSubmitFailure(failure),
        status: failure.status,
      },
    );
  };
}

function hasPersistedRemoteDocumentSyncState(record: DocumentRecord): boolean {
  return (
    record.lastCommitLsn !== null &&
    record.contentKeyBundle !== null &&
    record.documentKekTargets !== null &&
    record.documentManifestBundle !== null
  );
}

export function shouldSkipCleanScheduledDocumentSync(input: {
  currentRecord: DocumentRecord;
  pendingUpdates: readonly PendingUpdateRecord[];
  state: DocumentStoreState;
}): boolean {
  return (
    input.pendingUpdates.length === 0 &&
    input.state.pendingAttachments.length === 0 &&
    !input.state.remoteUpdatePending &&
    hasPersistedRemoteDocumentSyncState(input.currentRecord)
  );
}

/**
 * True when the store's container exists locally but has not been created on
 * the server yet (its own create intent is still pending). Creating a document
 * inside it would 404 on the container writer projection and surface a
 * spurious sync error; the container-contents lane re-arms document sync once
 * the container lands. An unknown or unqueryable container resolves false so
 * store-level consumers without container persistence keep creating eagerly.
 */
export async function isContainerAwaitingRemoteCreate(
  state: DocumentStoreState,
): Promise<boolean> {
  const containerId = state.runtime.state.containerId;
  if (!containerId) {
    return false;
  }

  try {
    const rows = await state.runtime.infra.execSql(
      "SELECT server_created_at FROM containers WHERE id = :containerId",
      { ":containerId": containerId },
    );
    const row = rows[0];
    return row !== undefined && Reflect.get(row, "server_created_at") == null;
  } catch {
    return false;
  }
}

export async function ensureRemoteDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord | null,
  encapsulationKeyPair: EncapsulationKeyPair,
  generation?: DocumentStoreSyncGeneration,
): Promise<DocumentRecord | null> {
  const generationIsCurrent = () =>
    !generation || isDocumentStoreSyncGenerationCurrent(state, generation);
  if (!generationIsCurrent()) return state.record ?? nextRecord;

  if (nextRecord?.documentId) {
    return nextRecord;
  }

  const runtime = state.runtime;
  if (!runtime.state.containerId) {
    runtime.util.log(
      "Documents: cannot create a remote document without a container.",
    );
    // A local-only document with no container scope (e.g. a last-link orphan
    // from a tombstone cascade, docs/sync-edge-cases.md row 3) can never
    // create; record the stuck state durably so the write queue surfaces it
    // instead of this lane going silent on every trigger.
    await documentTerminalSubmitFailureHandler(
      state,
      generation,
    )({
      message: "Local document has no container for its remote create",
      status: null,
    });
    return nextRecord;
  }

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.util.log(
      "Documents: skipped remote create because the writer context is unavailable.",
    );
    return nextRecord;
  }

  const documentId = await deriveStableDocumentId(state.localId);
  if (!generationIsCurrent()) return state.record ?? nextRecord;

  const created = await createRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    containerId: runtime.state.containerId,
    // Derive the remote id from the stable local id so a retry after a lost
    // create response re-sends the same id and adopts the existing remote
    // document instead of creating a duplicate.
    documentId,
    execSql: runtime.infra.execSql,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
    onTerminalSubmitFailure: documentTerminalSubmitFailureHandler(
      state,
      generation,
    ),
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
  });
  if (!generationIsCurrent()) return state.record ?? nextRecord;
  if (!created) {
    return nextRecord;
  }

  return chainIdentityWrite(state, async () => {
    if (!generationIsCurrent()) return state.record ?? nextRecord;

    // A concurrent relink (e.g. live duplicate-facade resolution) may have
    // assigned this store a different remote identity while the create round
    // trip was in flight. That identity wins: persisting the created one here
    // would clobber the relink. The just-created remote document is left an
    // orphan, the same benign outcome as a lost create response.
    const liveDocumentId = state.record?.documentId;
    if (liveDocumentId && liveDocumentId !== created.documentId) {
      return state.record;
    }

    runtime.util.log(`Created document: ${created.documentId}`);
    state.writerProjection = created.writerProjection;

    // This persist is a remote-identity write (documentId + content keys), not a
    // content change. It runs after a network round trip, during which the user
    // may have kept typing into a brand-new note. The Loro doc is mutated
    // asynchronously on the write chain, so it can lag the optimistic snapshot;
    // re-deriving text/structured fields from the doc here would republish that
    // stale read over the live editor value and drop the just-typed characters
    // (the new-note "type immediately" race). Preserve the optimistic snapshot —
    // documentId/keys still propagate via state.record, independent of the
    // snapshot text — matching finalizeDocumentSync and the keystroke writes.
    const persistPatch = { ...created.persistedState };
    const persistOptions = {
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    };
    const persisted = generation
      ? await persistDocument(
          state,
          currentDoc,
          persistPatch,
          persistOptions,
          generation,
        )
      : await persistDocument(state, currentDoc, persistPatch, persistOptions);
    return persisted?.record ?? state.record ?? nextRecord;
  });
}
