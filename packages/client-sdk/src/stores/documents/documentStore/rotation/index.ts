import { encodeVersionVector, versionVectorsEqual } from "@tearleads/loro";
import {
  claimThenAssertDocumentRotationAvailable,
  DOCUMENTS_APP_KIND,
  type DocumentRotationProofMode,
  isDatabaseUnavailableError,
  noteDocumentRotationDiverged,
  noteDocumentRotationProven,
  noteDocumentRotationRebuilt,
  readDocumentRotationLeftOut,
} from "../../../../workflows/documents";
import { reportQuietly } from "../../../../workflows/documents/sync/reportQuietly";

import { requestDocumentStoreSync } from "../../registry";
import { installRebuiltDocument } from "../history/historyRebuild";
import { chainIdentityWrite } from "../identityWriteChain";
import { chainQueuedWrite } from "../localWriteQueue";
import { listPendingUpdates } from "../persistence";
import type { DocumentState, DocumentStoreState } from "../state";
import { createStoredDocument } from "../storedDocument";
import { runDocumentRemoteWork } from "../sync/remoteWork";
import {
  captureDocumentStoreAttachmentSyncGeneration,
  captureDocumentStoreSyncLaneGeneration,
  type DocumentStoreSyncGeneration,
  type DocumentStoreSyncLaneGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";
import {
  currentRecordedRotationProof,
  recordRotationProof,
} from "./rotationProofRecord";
import {
  assertExactDocumentHistory,
  importProvenOrdinaryPendingHistory,
  RotationHistoryMismatchError,
} from "./rotationProvenance";
import { RotationRawHistoryVoids } from "./rotationRawHistoryJudge";
import {
  assertRotationRecoveryGeneration,
  assertRotationRecoveryPrerequisites,
  pullVerifiedRawHistoryForRotation,
} from "./rotationRawHistoryPull";
import {
  invalidatePullContinuationBeforeRotation,
  RotationPendingUpdatesChangedError,
  settleOrdinaryDocumentUpdatesBeforeRotation,
} from "./rotationSettlement";

/**
 * Rotation availability is bookkeeping beside the rotation: a note that
 * fails to write leaves the stored state for a later attempt to decide, and
 * neither fails a proven rotation nor hides a failed one's own error. The
 * failure is reported to the host, unless the database is gone (teardown).
 */
function noteBesideRotation(
  state: DocumentStoreState,
  note: Promise<unknown>,
): Promise<void> {
  return note.then(
    () => undefined,
    (error: unknown) => {
      if (isDatabaseUnavailableError(error)) return;
      reportQuietly(
        state.runtime.util.logError,
        "Documents: a key rotation's availability note was not written; the stored state stands for a later rotation",
        error,
      );
    },
  );
}

async function collectVerifiedRawHistoryForRotation(input: {
  currentRecord: NonNullable<DocumentStoreState["record"]>;
  documentId: string;
  generation: DocumentStoreSyncGeneration;
  leftOut: readonly string[];
  state: DocumentStoreState;
}) {
  const consumedPullContinuation = input.state.pullContinuation;
  const writerProjectionGeneration = input.state.writerProjectionGeneration;
  const rebuiltDocument = await createStoredDocument(
    input.state,
    input.currentRecord.peerSalt,
  );
  const voids = new RotationRawHistoryVoids(input.leftOut);
  try {
    const synced = await pullVerifiedRawHistoryForRotation({
      ...input,
      rebuiltDocument,
      voids,
    });
    // The rebuild outlived every page: earlier deaths were not its to keep.
    await noteBesideRotation(
      input.state,
      noteDocumentRotationRebuilt({
        documentId: input.documentId,
        execSql: input.state.runtime.infra.execSql,
        isCurrent: () =>
          isDocumentStoreSyncGenerationCurrent(input.state, input.generation),
        scope: { appKind: DOCUMENTS_APP_KIND, localId: input.state.localId },
      }),
    );
    return {
      consumedPullContinuation,
      currentRecord: input.currentRecord,
      rebuiltDocument,
      synced,
      voids,
      writerProjectionGeneration,
    };
  } catch (error) {
    rebuiltDocument.free();
    throw error;
  }
}

class RotationDocumentChangedError extends Error {}

function assertCapturedDocumentCurrent(input: {
  capturedVersion: string;
  currentDocument: DocumentState;
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}): void {
  assertRotationRecoveryGeneration(input);
  if (
    !versionVectorsEqual(
      encodeVersionVector(input.currentDocument),
      input.capturedVersion,
    )
  ) {
    throw new RotationDocumentChangedError(
      "Document changed during rotation recovery; retry key rotation",
    );
  }
}

function currentRotationRecoveryRecord(
  state: DocumentStoreState,
): NonNullable<DocumentStoreState["record"]> {
  if (state.record) return state.record;
  throw new Error(
    "Document changed during rotation recovery; retry key rotation",
  );
}

function installRotationRecovery(input: {
  capturedVersion: string;
  documentId: string;
  leftOut: readonly string[];
  collection: Awaited<ReturnType<typeof collectVerifiedRawHistoryForRotation>>;
  currentDoc: DocumentState;
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}) {
  const {
    capturedVersion,
    collection,
    currentDoc,
    documentId,
    generation,
    leftOut,
    state,
  } = input;
  const installation = state.writeChain
    .catch(() => undefined)
    .then(() =>
      chainIdentityWrite(state, async () => {
        assertCapturedDocumentCurrent({
          capturedVersion,
          currentDocument: currentDoc,
          generation,
          state,
        });
        assertExactDocumentHistory({
          currentDocument: currentDoc,
          leftOutEnds: collection.voids.leftOutEnds,
          rebuiltDocument: collection.rebuiltDocument,
        });
        // Only a proven rebuild vouches for the voids it left out, and for
        // an update it left out unread (`leavingOut`). They are recorded
        // while the pass is current, which the install ends.
        await collection.voids.record({ generation, state });
        await noteBesideRotation(
          state,
          noteDocumentRotationProven({
            documentId,
            execSql: state.runtime.infra.execSql,
            leftOut,
            isCurrent: () =>
              isDocumentStoreSyncGenerationCurrent(state, generation),
            scope: { appKind: DOCUMENTS_APP_KIND, localId: state.localId },
          }),
        );
        return installRebuiltDocument({
          consumedPullContinuation: collection.consumedPullContinuation,
          currentRecord: collection.currentRecord,
          generation,
          rebuiltDoc: collection.rebuiltDocument,
          state,
          synced: collection.synced,
          writerProjectionGeneration: collection.writerProjectionGeneration,
        });
      }),
    );
  // Only the checked local install occupies the write queue. Network recovery
  // uses the remote queue, so an outage cannot hold new edits hostage.
  void chainQueuedWrite(
    state,
    installation.then(
      () => undefined,
      () => undefined,
    ),
  );
  return installation;
}

async function recoverFullHistoryForRotation(
  state: DocumentStoreState,
  laneGeneration: DocumentStoreSyncLaneGeneration,
  leftOut: readonly string[],
): Promise<Uint8Array> {
  const { documentId } = assertRotationRecoveryPrerequisites(state);
  await invalidatePullContinuationBeforeRotation(state);
  const currentDoc = state.doc;
  const currentRecord = state.record;
  if (!currentDoc || !currentRecord) {
    throw new Error(
      "Document must finish loading before its content key can rotate",
    );
  }
  // The teardown guard for the recovery's terminal-failure handler: captured
  // before the pull so a discard (row 21) racing this preflight invalidates
  // it, and the stale handler cannot resurrect a deleted failure row.
  const generation = captureDocumentStoreAttachmentSyncGeneration(
    state,
    currentDoc,
    laneGeneration,
  );
  if (!generation) {
    throw new Error(
      "Document changed during rotation recovery; retry key rotation",
    );
  }

  const capturedVersion = encodeVersionVector(currentDoc);
  const assertCurrent = () =>
    assertCapturedDocumentCurrent({
      capturedVersion,
      currentDocument: currentDoc,
      generation,
      state,
    });
  const recovery = { documentId, generation, leftOut, state };
  let settlementRequiresRetry = false;

  // A raw recovery starts from an empty scratch document, bypasses untrusted
  // rotation-baseline redirects, drains every retained page in memory, and
  // publishes nothing until all response updates have validated. It rebuilds
  // what an honest sync pass applied, no more and no less: every ordinary
  // update, so no checkpoint's coverage stands in for one, and every served
  // checkpoint the judge accepted, which can only add its writer's signed
  // operations. A checkpoint queued or installed locally is never an input.
  let collection = await collectVerifiedRawHistoryForRotation({
    ...recovery,
    currentRecord,
  });

  try {
    assertCurrent();
    const pendingUpdates = await listPendingUpdates(state);
    assertCurrent();
    const verifiedOrdinaryVersion = importProvenOrdinaryPendingHistory({
      currentDocument: currentDoc,
      leftOutEnds: collection.voids.leftOutEnds,
      pendingUpdates,
      rebuiltDocument: collection.rebuiltDocument,
    });
    if (pendingUpdates.some((update) => update.sourceVersionVector == null)) {
      // The first raw pass proves the exact ordinary frontier before any local
      // row can be published. Pull raw history again after settlement so the
      // installed snapshot also includes remote work that raced that submit.
      await settleOrdinaryDocumentUpdatesBeforeRotation(
        state,
        verifiedOrdinaryVersion,
        pendingUpdates,
        generation,
      );
      assertCurrent();
      const definitiveCollection = await collectVerifiedRawHistoryForRotation({
        ...recovery,
        currentRecord: currentRotationRecoveryRecord(state),
      });
      collection.rebuiltDocument.free();
      collection = definitiveCollection;
    }
    const installed = await installRotationRecovery({
      ...recovery,
      capturedVersion,
      collection,
      currentDoc,
    });
    settlementRequiresRetry = installed.settlementRequiresRetry;
    if (settlementRequiresRetry) {
      throw new Error(
        "Rotation raw-history recovery was superseded during its atomic install; retry key rotation",
      );
    }
    return installed.fullHistorySnapshot;
  } finally {
    if (state.doc !== collection.rebuiltDocument) {
      collection.rebuiltDocument.free();
    }
    if (settlementRequiresRetry) {
      requestDocumentStoreSync(state);
    }
  }
}

/**
 * Wait for prior local writes and serialize with other remote work. Edits can
 * continue during the pull; the checked install rejects a changed document so
 * a stale recovery cannot replace them. This preflight can then be retried.
 * `reuse` returns the last completed proof while it still covers this exact
 * local document (rotationProofRecord); otherwise it proves like `prove`.
 */
export function assertDocumentStoreCanRotateContentKey(
  state: DocumentStoreState,
  proof: DocumentRotationProofMode = "prove",
): Promise<Uint8Array> {
  const laneGeneration = captureDocumentStoreSyncLaneGeneration(state);
  const generation = captureDocumentStoreAttachmentSyncGeneration(
    state,
    state.doc,
    laneGeneration,
  );
  return runDocumentRemoteWork(state, async () => {
    await state.writeChain.catch(() => undefined);
    if (
      !generation ||
      !isDocumentStoreSyncGenerationCurrent(state, generation)
    ) {
      throw new Error(
        "Document changed before rotation recovery; retry key rotation",
      );
    }
    const recorded =
      proof === "reuse" ? currentRecordedRotationProof(state) : null;
    if (recorded) return recorded;
    const snapshot = await proveFullHistoryForRotation(
      state,
      laneGeneration,
      generation,
    );
    recordRotationProof(state, snapshot);
    return snapshot;
  });
}

async function proveFullHistoryForRotation(
  state: DocumentStoreState,
  laneGeneration: DocumentStoreSyncLaneGeneration,
  generation: DocumentStoreSyncGeneration,
): Promise<Uint8Array> {
  // A device whose rebuilds of this history keep ending the process starts
  // no rotation of it; other members rotate it (#3194).
  const rotation = {
    documentId: assertRotationRecoveryPrerequisites(state).documentId,
    execSql: state.runtime.infra.execSql,
    isCurrent: () => isDocumentStoreSyncGenerationCurrent(state, generation),
    logError: state.runtime.util.logError,
    scope: { appKind: DOCUMENTS_APP_KIND, localId: state.localId },
  };
  await claimThenAssertDocumentRotationAvailable(rotation);
  for (let attempt = 0; ; attempt += 1) {
    // An update the rotation's deaths came to rest on alone is left out,
    // unread, and the exact-history check then decides the rotation.
    const leftOut = await readDocumentRotationLeftOut(rotation);
    try {
      return await recoverFullHistoryForRotation(
        state,
        laneGeneration,
        leftOut,
      );
    } catch (error) {
      // A rebuild that left out updates its deaths came to rest on, and
      // differs from the live document within their spans, shows the
      // device holds one.
      if (error instanceof RotationHistoryMismatchError && error.heldLeftOut) {
        await noteBesideRotation(
          state,
          noteDocumentRotationDiverged({ ...rotation, leftOut }),
        );
      }
      // Autosaves and conflict re-keying can invalidate the proven frontier.
      // Repeat the complete proof without blocking new local edits; repeated
      // changes remain bounded and leave the durable queue retryable.
      if (
        !(
          error instanceof RotationPendingUpdatesChangedError ||
          error instanceof RotationDocumentChangedError
        ) ||
        attempt >= 2 ||
        !isDocumentStoreSyncGenerationCurrent(state, generation)
      ) {
        throw error;
      }
    }
  }
}
