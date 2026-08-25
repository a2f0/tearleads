import { encodeVersionVector } from "@symcrypt/loro";
import { importDecryptedDocumentSyncUpdates } from "../../../data/documents/shared/documentSyncUpdateIsolation";
import type { DecryptedDocumentSyncUpdate } from "../../../data/documents/shared/types";
import type { DocumentRecord } from "../../../workflows/documents";
import type { DocumentSyncAttempt } from "./state";
import {
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { extendDocumentVersionCoverage } from "./versionCoverage";

function sameNullableValue(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

/**
 * A response may mutate document content only while the identity and access
 * context used to create its request are still live. Local content fields and
 * the pending marker are deliberately excluded because edits may advance them
 * while the request is in flight.
 */
export function documentSyncContextMatches(
  liveRecord: DocumentRecord | null,
  requestRecord: DocumentRecord,
  responseDocumentId: string | null,
): boolean {
  return (
    liveRecord !== null &&
    liveRecord.id === requestRecord.id &&
    liveRecord.documentId === requestRecord.documentId &&
    liveRecord.documentId === responseDocumentId &&
    liveRecord.containerId === requestRecord.containerId &&
    liveRecord.accessEpoch === requestRecord.accessEpoch &&
    sameNullableValue(
      liveRecord.accessStateHash,
      requestRecord.accessStateHash,
    ) &&
    (liveRecord.effectiveAccessLevel ?? null) ===
      (requestRecord.effectiveAccessLevel ?? null) &&
    sameNullableValue(
      liveRecord.contentKeyBundle,
      requestRecord.contentKeyBundle,
    ) &&
    sameNullableValue(
      liveRecord.documentKekTargets,
      requestRecord.documentKekTargets,
    ) &&
    sameNullableValue(
      liveRecord.documentManifestBundle,
      requestRecord.documentManifestBundle,
    )
  );
}

export function importSyncedDocumentUpdates(
  currentDoc: DocumentState,
  updates: readonly DecryptedDocumentSyncUpdate[],
): DocumentState {
  importDecryptedDocumentSyncUpdates(currentDoc, updates);
  return currentDoc;
}

export function applyIncomingSyncedUpdates(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  requestRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
  expectedGeneration?: DocumentStoreSyncGeneration,
): DocumentState {
  if (
    (expectedGeneration &&
      !isDocumentStoreSyncGenerationCurrent(state, expectedGeneration)) ||
    !documentSyncContextMatches(
      state.record,
      requestRecord,
      syncAttempt.synced.plan.documentId,
    )
  ) {
    return currentDoc;
  }

  const updates = syncAttempt.synced.decryptedUpdates;
  if (updates.length === 0) return currentDoc;

  const mergedDoc = importSyncedDocumentUpdates(currentDoc, updates);
  const baseVersion = state.pendingBaseVersion;
  if (baseVersion === null) {
    throw new Error("Document sync requires an initialized pending base");
  }
  // Promote only through update spans proven to be remote. Advancing to the
  // whole merged document would also cross a concurrent deferRemoteSync edit
  // and could permanently classify that local-only operation as synced.
  state.pendingBaseVersion = extendDocumentVersionCoverage({
    baseVersion,
    documentVersion: encodeVersionVector(mergedDoc),
    spans: updates,
  });

  if (state.pendingLocalWrites > 0) {
    setReadySnapshot(
      state,
      mergedDoc,
      true,
      state.snapshot.text,
      state.snapshot.structuredFields,
    );
    return mergedDoc;
  }

  setReadySnapshot(state, mergedDoc, true);
  return mergedDoc;
}
