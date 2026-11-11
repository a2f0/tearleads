import {
  encodeVersionVector,
  exportUpdatesSince,
  mergeVersionVectors,
  satisfiesVersionVector,
} from "@tearleads/loro";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../../../workflows/documents";
import { chainIdentityWrite } from "../identityWriteChain";
import { rebaseDocumentAfterPendingUpdateRefusal } from "../pendingUpdateRefusal";
import {
  clearCoveredUnsavedLocalEdits,
  enqueuePendingUpdate,
  listPendingUpdates,
  persistDocument,
} from "../persistence";
import type { DocumentState, DocumentStoreState } from "../state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { extendDocumentVersionCoverage } from "./versionCoverage";

interface PreparedOutgoingCoverage {
  readonly pendingUpdates: PendingUpdateRecord[];
  readonly record: DocumentRecord;
}

function requirePendingBase(version: string | null, message: string): string {
  if (version === null) {
    throw new Error(message);
  }
  return version;
}

function queuedHistoryBelongsToDocument(
  documentVersion: string,
  pendingUpdates: readonly PendingUpdateRecord[],
): boolean {
  return pendingUpdates.every((update) => {
    try {
      return satisfiesVersionVector(
        documentVersion,
        update.partialEndVersionVector,
      );
    } catch {
      return false;
    }
  });
}

/**
 * Rebuild the durable outgoing frontier before a sync can clean-skip or delete
 * accepted queue rows. Existing rows promote the marker only through connected
 * spans. Any remaining snapshot tail is exported and enqueued before the marker
 * advances, so a restart at every await remains lossless.
 */
export async function prepareDocumentOutgoingCoverage(input: {
  /** A separately verified frontier used only to prove outgoing coverage. */
  readonly coverageBaseVersion?: string | undefined;
  readonly currentDoc: DocumentState;
  readonly generation: DocumentStoreSyncGeneration;
  readonly pendingUpdates: PendingUpdateRecord[];
  readonly state: DocumentStoreState;
}): Promise<PreparedOutgoingCoverage | null> {
  const { currentDoc, generation, state } = input;
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;

  const baseVersion = requirePendingBase(
    input.coverageBaseVersion ?? state.pendingBaseVersion,
    "Document sync requires an initialized pending base",
  );

  const documentVersion = encodeVersionVector(currentDoc);
  const queuedCoverage = extendDocumentVersionCoverage({
    baseVersion,
    documentVersion,
    spans: input.pendingUpdates,
  });
  let pendingUpdates = input.pendingUpdates;
  let preparedCoverage = queuedCoverage;

  if (!satisfiesVersionVector(queuedCoverage, documentVersion)) {
    const deferredUpdate = exportUpdatesSince(currentDoc, queuedCoverage);
    const enqueued = await enqueuePendingUpdate(
      state,
      deferredUpdate,
      undefined,
      generation,
    );
    if (!enqueued) {
      await rebaseDocumentAfterPendingUpdateRefusal(state, generation);
      return null;
    }
    if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;

    pendingUpdates = await listPendingUpdates(state);
    if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;

    preparedCoverage = documentVersion;
    state.runtime.util.log(
      "Documents: materialized a deferred outgoing update before sync.",
    );
  }

  // A local write may have advanced the in-memory frontier while the enqueue
  // awaited. Merge instead of assigning so this background repair can never
  // move the marker backwards.
  const liveBaseVersion = requirePendingBase(
    state.pendingBaseVersion,
    "Document sync lost its pending base",
  );
  const nextBaseVersion = mergeVersionVectors([
    liveBaseVersion,
    preparedCoverage,
  ]);

  const liveRecord = state.record;
  if (!liveRecord) {
    throw new Error("Document sync lost its persisted record");
  }
  // Another runtime may have queued durable history this live doc lacks.
  // Keep the existing reconciliation persist in that case: queue merging
  // must prove those rows against the refreshed document, not send them twice.
  if (
    liveRecord.pendingBaseVersion === nextBaseVersion &&
    queuedHistoryBelongsToDocument(documentVersion, pendingUpdates)
  ) {
    state.pendingBaseVersion = nextBaseVersion;
    clearCoveredUnsavedLocalEdits(state);
    return { pendingUpdates, record: liveRecord };
  }

  const persisted = await chainIdentityWrite(state, async () => {
    if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;

    return persistDocument(
      state,
      currentDoc,
      {
        // Every op in nextBaseVersion is durably enqueued — the marker's
        // definition, plus the deferred delta enqueued above — so the
        // frontier advances with the marker. Left behind, the settled
        // document would stay listed (and primed) as a deferred tail
        // forever.
        snapshotEndVersion: mergeVersionVectors([
          ...(liveRecord.snapshotEndVersion.length > 0
            ? [liveRecord.snapshotEndVersion]
            : []),
          nextBaseVersion,
        ]),
      },
      {
        pendingBaseVersionOverride: nextBaseVersion,
        preserveSnapshotStructuredFields: true,
        preserveSnapshotText: true,
      },
      generation,
    );
  });
  if (!persisted || !isDocumentStoreSyncGenerationCurrent(state, generation)) {
    return null;
  }

  const currentBaseVersion = state.pendingBaseVersion;
  if (currentBaseVersion === null) return null;
  state.pendingBaseVersion = mergeVersionVectors([
    currentBaseVersion,
    nextBaseVersion,
  ]);
  // A failed local save's ops this pass enqueued are durable now.
  clearCoveredUnsavedLocalEdits(state);
  return { pendingUpdates, record: persisted.record };
}
