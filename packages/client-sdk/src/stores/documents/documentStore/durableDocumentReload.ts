import { base64ToBytes } from "@tearleads/encoding";
import { importSnapshot } from "@tearleads/loro";
import {
  importDocumentHistoryTailUpdates,
  runSerializedSqlMutation,
} from "../../../workflows/documents";
import {
  type DocumentState,
  type DocumentStoreState,
  markDocumentStoreRemoved,
  setReadySnapshot,
} from "./state";
import { createFreshPeerStoredDocument } from "./storedDocument";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

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
  state.writerProjection = null;
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

  const replacementDoc = await createFreshPeerStoredDocument();
  return runSerializedSqlMutation(
    state.runtime.infra.execSql,
    async (lockedExecSql) => {
      if (!isDocumentStoreSyncGenerationCurrent(state, expectedGeneration)) {
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
      importDurableDocumentHistory(replacementDoc, historyRestoreState);
      if (!isDocumentStoreSyncGenerationCurrent(state, expectedGeneration)) {
        return false;
      }

      installDurableDocumentReload({
        durableRecord,
        preserveQueuedWritesWhenIdentityMatches:
          input.preserveQueuedWritesWhenIdentityMatches,
        replacementDoc,
        state,
      });
      return true;
    },
  );
}
