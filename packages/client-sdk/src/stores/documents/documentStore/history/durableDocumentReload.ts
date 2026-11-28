import { base64ToBytes } from "@tearleads/encoding";
import { importSnapshot } from "@tearleads/loro";
import {
  importDocumentHistoryTailUpdates,
  retryWhileDatabaseBusy,
  runSerializedSqlMutation,
} from "../../../../workflows/documents";
import { noteDocumentStoreWrite } from "../reportWriteFailure";
import {
  type DocumentState,
  type DocumentStoreState,
  markDocumentStoreRemoved,
  setReadySnapshot,
} from "../state";
import { createFreshPeerStoredDocument } from "../storedDocument";
import { resetDocumentPeerRestorePark } from "../sync/peerRestorePark";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";

type DurableDocumentRecord = NonNullable<
  Awaited<ReturnType<DocumentStoreState["persistence"]["loadDocument"]>>
>;
type DurableHistory = Awaited<
  ReturnType<DocumentStoreState["persistence"]["loadHistoryRestoreState"]>
>;

export function importDurableDocumentHistory(
  replacementDoc: DocumentState,
  history: DurableHistory,
): void {
  if (history?.snapshot) {
    importSnapshot(replacementDoc, base64ToBytes(history.snapshot));
  }
  if (history) {
    importDocumentHistoryTailUpdates(
      replacementDoc,
      history.tailUpdates.map((update) => update.updateData),
    );
  }
}

export function installDurableDocumentReload(input: {
  durableRecord: DurableDocumentRecord;
  previousDocumentId?: string | null | undefined;
  preserveQueuedWritesWhenIdentityMatches: boolean;
  registerIdentityChange?: boolean | undefined;
  replacementDoc: DocumentState;
  /** The replacement imported the live doc, unsaved local edits included. */
  retainsLiveDocEdits?: boolean | undefined;
  state: DocumentStoreState;
}): void {
  const { durableRecord, replacementDoc, state } = input;
  const previousDocumentId =
    input.previousDocumentId === undefined
      ? (state.record?.documentId ?? null)
      : input.previousDocumentId;
  const identityChanged = previousDocumentId !== durableRecord.documentId;
  const preserveQueuedWrites =
    input.preserveQueuedWritesWhenIdentityMatches && !identityChanged;
  if (!preserveQueuedWrites) {
    state.localWriteGeneration += 1;
    state.pendingLocalWrites = 0;
  }
  state.record = durableRecord;
  state.pullContinuation = durableRecord.pullContinuation ?? null;
  state.pendingBaseVersion =
    durableRecord.pendingBaseVersion ??
    (durableRecord.snapshotEndVersion.length > 0
      ? durableRecord.snapshotEndVersion
      : null);
  state.doc = replacementDoc;
  // Ops only the live doc held are gone unless the replacement imported them.
  if (!input.retainsLiveDocEdits) state.unsavedLocalEdits = false;
  state.writerProjection = null;
  if (identityChanged) {
    resetDocumentPeerRestorePark(state);
  }
  if (identityChanged && input.registerIdentityChange !== false) {
    state.effects.registerDocumentIdentity(
      state.runtime.state.domainScope,
      durableRecord.id,
      durableRecord.documentId,
    );
  }
  const preserveOptimisticProjection =
    preserveQueuedWrites && state.pendingLocalWrites > 0;
  setReadySnapshot(
    state,
    replacementDoc,
    state.snapshot.syncing,
    preserveOptimisticProjection ? state.snapshot.text : undefined,
    preserveOptimisticProjection ? state.snapshot.structuredFields : undefined,
  );
}

async function installReloadedDurableDocument(input: {
  durableRecord: DurableDocumentRecord;
  expectedGeneration: DocumentStoreSyncGeneration;
  historyRestoreState: DurableHistory;
  preserveQueuedWritesWhenIdentityMatches: boolean;
  sameIdentitySnapshot?: Uint8Array | undefined;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { durableRecord, expectedGeneration, state } = input;
  const replacementDoc = await createFreshPeerStoredDocument();
  let installed = false;
  try {
    const canRestoreCapturedSnapshot = Boolean(
      input.sameIdentitySnapshot &&
        (state.record?.documentId ?? null) === durableRecord.documentId,
    );
    if (canRestoreCapturedSnapshot && input.sameIdentitySnapshot) {
      importSnapshot(replacementDoc, input.sameIdentitySnapshot);
    }
    // The captured snapshot removes the failed in-memory mutation, but it
    // cannot replace the durable source of truth: another pane may have
    // advanced history and the record frontier while attachment staging was
    // in flight. Merge the latest checkpoint and tail in both paths before
    // installing that record/frontier beside the rebuilt CRDT.
    importDurableDocumentHistory(replacementDoc, input.historyRestoreState);
    if (!isDocumentStoreSyncGenerationCurrent(state, expectedGeneration)) {
      return false;
    }

    installDurableDocumentReload({
      durableRecord,
      preserveQueuedWritesWhenIdentityMatches:
        input.preserveQueuedWritesWhenIdentityMatches,
      replacementDoc,
      retainsLiveDocEdits: canRestoreCapturedSnapshot,
      state,
    });
    installed = true;
    return true;
  } finally {
    if (!installed && state.doc !== replacementDoc) replacementDoc.free();
  }
}

export async function reloadDocumentFromDurableHistory(input: {
  expectedGeneration: DocumentStoreSyncGeneration;
  preserveQueuedWritesWhenIdentityMatches: boolean;
  sameIdentitySnapshot?: Uint8Array | undefined;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { expectedGeneration, state } = input;
  if (!isDocumentStoreSyncGenerationCurrent(state, expectedGeneration)) {
    return false;
  }

  return retryWhileDatabaseBusy(
    () =>
      runSerializedSqlMutation(
        state.runtime.infra.execSql,
        async (lockedExecSql) => {
          if (
            !isDocumentStoreSyncGenerationCurrent(state, expectedGeneration)
          ) {
            return false;
          }
          const { document: durableRecord, historyRestoreState } =
            await state.persistence.loadDocumentWithHistoryRestoreState(
              lockedExecSql,
              state.localId,
            );
          if (!durableRecord) {
            markDocumentStoreRemoved(state);
            return false;
          }
          return installReloadedDurableDocument({
            durableRecord,
            expectedGeneration,
            historyRestoreState,
            preserveQueuedWritesWhenIdentityMatches:
              input.preserveQueuedWritesWhenIdentityMatches,
            sameIdentitySnapshot: input.sameIdentitySnapshot,
            state,
          });
        },
      ),
    {
      isCurrent: () =>
        isDocumentStoreSyncGenerationCurrent(state, expectedGeneration),
      onBusy: () => {
        noteDocumentStoreWrite(
          state,
          "Documents: durable history reload delayed behind another tab's database transaction",
        );
      },
    },
  );
}
