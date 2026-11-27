import { bytesToBase64 } from "@tearleads/encoding";
import {
  emptyVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  updateText,
} from "@tearleads/loro";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../../../data/documents/documentConstants";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
} from "../../../../data/documents/documentKinds";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import type { DocumentRecord } from "../../../../workflows/documents";
import { saveDocumentRecord } from "../persistence";
import type { DocumentState, DocumentStoreState } from "../state";
import { writeInitialDocumentContent } from "./initialContent";

export async function createInitialDocumentRecord(
  state: DocumentStoreState,
  nextDoc: DocumentState,
): ReturnType<typeof saveDocumentRecord> {
  initializeStoredDocumentKind(
    nextDoc,
    state.initialDocumentKind,
    state.runtime.infra.documentProjectors,
  );
  if (state.initialText) updateText(nextDoc, state.initialText);
  const wroteInitialContent = writeInitialDocumentContent(state, nextDoc);
  const initialDocumentState = readStoredDocumentState(
    nextDoc,
    state.runtime.infra.documentProjectors,
  );
  const hasInitialContent =
    wroteInitialContent ||
    state.initialText.length > 0 ||
    state.initialDocumentKind !== DEFAULT_DOCUMENT_KIND;
  const initialUpdate = hasInitialContent
    ? createPendingUpdateFields(exportAllUpdates(nextDoc))
    : null;
  // A deferred birth still commits its checkpoint, but leaves the marker at the
  // empty version with nothing queued: the promised attach exports every op
  // since that marker, so one update carries the birth and the attachment.
  const birthDurability = !initialUpdate
    ? {}
    : state.deferInitialUpdate
      ? { pendingBaseVersionOverride: emptyVersionVector() }
      : { pendingUpdate: initialUpdate };

  const created: DocumentRecord = {
    id: state.localId,
    containerId: state.runtime.state.containerId ?? null,
    documentId: state.initialDocumentId,
    documentKind: initialDocumentState.documentKind,
    text: initialDocumentState.text,
    title: initialDocumentState.title,
    snapshotEndVersion: encodeVersionVector(nextDoc),
    accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
    accessStateHash: null,
    effectiveAccessLevel: "admin",
    lastCommitLsn: null,
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  };
  // The create-only persistence primitive commits the canonical row and birth
  // checkpoint together. A concurrent initializer either wins both or adopts
  // both, so it cannot replace another pane's history or keying state.
  return saveDocumentRecord(
    state,
    nextDoc,
    {
      ...created,
      snapshotEndVersion: encodeVersionVector(nextDoc),
    },
    {
      historyCheckpoint: {
        coveredTailIds: [],
        endVersionVector: encodeVersionVector(nextDoc),
        pruneCoveredLocalState: false,
        snapshot: bytesToBase64(exportFullHistorySnapshot(nextDoc)),
      },
      ...birthDurability,
    },
  );
}
