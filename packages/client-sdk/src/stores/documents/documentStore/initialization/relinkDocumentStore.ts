import type { DocumentSummary } from "../../../../data/documents/documentSummary";
import type { DocumentStoreRelinkInput } from "../../types";
import { chainIdentityWrite } from "../identityWriteChain";
import type { DocumentRelinkCommitSideEffect } from "../internalRelink";
import { documentSummaryFromRecord, persistDocument } from "../persistence";
import type { DocumentStoreState } from "../state";
import { resetDocumentPeerRestorePark } from "../sync/peerRestorePark";
import {
  captureDocumentStoreSyncGeneration,
  invalidateDocumentStoreRemoteSync,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";
import { ensureDocumentStoreReady } from "./index";
import { relinkRecordPatch } from "./relinkRecordPatch";

export async function relinkDocumentStore(
  state: DocumentStoreState,
  input: DocumentStoreRelinkInput,
  scheduleSync: () => void,
  commitSideEffect?: DocumentRelinkCommitSideEffect,
): Promise<DocumentSummary | null> {
  if (
    input.stillCurrent?.() === false ||
    !(await ensureDocumentStoreReady(state, scheduleSync)) ||
    input.stillCurrent?.() === false ||
    !state.doc
  ) {
    return null;
  }
  const currentDoc = state.doc;
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) return null;
  // Read the record and persist on the identity-write chain so an in-flight
  // eager create cannot interleave: a create that captured a null identity
  // before its network round trip would otherwise write the derived documentId
  // over the one this relink assigns.
  const persisted = await chainIdentityWrite(state, async () => {
    if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;
    const currentDocumentId = state.record?.documentId ?? null;
    const patch = relinkRecordPatch(state.record, input);

    // Relink rewrites access/identity metadata, not content. If it lands while
    // the user is mid-edit, re-deriving text/structured fields from the
    // (possibly lagging) doc would republish a stale read over the live
    // optimistic snapshot and drop in-flight keystrokes; preserve the snapshot
    // like the keystroke and sync persists do.
    // A prior chained write may have cleared this store (resurrect-guard
    // refusal): persisting the captured doc against a null record would
    // resurrect the document as a create. The identity check runs inside
    // the chain, after every earlier write settled.
    if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
      return null;
    }
    const result = await persistDocument(
      state,
      currentDoc,
      patch,
      {
        preserveSnapshotStructuredFields: true,
        preserveSnapshotText: true,
        stillCurrent: input.stillCurrent,
      },
      generation,
      commitSideEffect,
    );
    if (result && currentDocumentId !== input.documentId) {
      state.writerProjection = null;
      resetDocumentPeerRestorePark(state);
      invalidateDocumentStoreRemoteSync(state);
    }
    return result;
  });
  // A refused persist means the durable row vanished mid-relink (resurrect
  // guard); there is no summary to report.
  if (!persisted) {
    return null;
  }
  if (persisted.updatedAt === undefined) {
    return null;
  }
  return documentSummaryFromRecord(
    persisted.record,
    persisted.updatedAt,
    state.runtime.infra.documentProjectors,
  );
}
