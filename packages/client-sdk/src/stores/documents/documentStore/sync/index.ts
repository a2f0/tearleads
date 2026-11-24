import { reportAndRethrowKeyingVerificationError } from "../../../../data/shared/securityIncidents";
import {
  createDocumentSyncLoroWindow,
  type DocumentRecord,
  type DocumentSyncLane,
  type DocumentSyncLoroWindow,
  isDatabaseUnavailableError,
  registerDocumentSyncLane,
  resolveDocumentCreateAuthor,
  settleDocumentSyncLoroWindow,
} from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { requestDocumentStoreSync } from "../../registry";
import { awaitInitializationForSync } from "../initialization";
import { listPendingUpdates } from "../persistence";
import {
  type DocumentState,
  type DocumentStoreState,
  type EncapsulationKeyPair,
  setDocumentSyncing,
} from "../state";
import {
  getActiveDocumentRemoteWork,
  runDocumentRemoteWork,
} from "./remoteWork";
import { syncPendingAttachments } from "./syncAttachments";
import { syncDetachedAttachmentBindings } from "./syncDetachedAttachments";
import { syncDocumentState } from "./syncDocumentState";
import { captureSyncedDocumentView } from "./syncedDocumentView";
import {
  captureDocumentStoreAttachmentSyncGeneration,
  captureDocumentStoreRemoteSyncGeneration,
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  type DocumentStoreSyncLaneGeneration,
  isDocumentStoreSyncGenerationCurrent,
  isDocumentStoreSyncLaneGenerationCurrent,
} from "./syncGeneration";
import { revalidateRemoteDocumentBeforeAttachments } from "./syncRevalidation";

function canRunScheduledSync(state: DocumentStoreState): boolean {
  return (
    // A deferred birth waits for its attach to carry it (see
    // deferredInitialUpdate.ts); a pass now would ship it on its own.
    state.deferInitialUpdate !== true &&
    state.doc !== null &&
    state.snapshot.ready &&
    state.runtime.state.online &&
    state.runtime.auth.isAuthenticated &&
    state.runtime.crypto.encapsulationKeyPair !== null &&
    resolveDocumentCreateAuthor(state.runtime) !== null
  );
}

export function canSyncDetachedAttachmentBindings(
  record: DocumentRecord,
  pendingUpdateCount: number,
): boolean {
  return (
    pendingUpdateCount === 0 &&
    (record.pullContinuation ?? null) === null &&
    !record.pullContinuationRecoveryRequired
  );
}

async function runDocumentSyncPass(
  state: DocumentStoreState,
  syncLaneGeneration: DocumentStoreSyncLaneGeneration,
  policyOperation: PrincipalPolicyOperation,
) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  const nextRecord = state.record;

  if (!currentDoc || !nextRecord || !encapsulationKeyPair) {
    return;
  }

  const generation = captureDocumentStoreRemoteSyncGeneration(
    state,
    currentDoc,
    syncLaneGeneration,
  );
  const attachmentGeneration = captureDocumentStoreAttachmentSyncGeneration(
    state,
    currentDoc,
    syncLaneGeneration,
  );
  if (!generation || !attachmentGeneration) {
    requestDocumentStoreSync(state);
    return;
  }

  // The pass's pulls read in its own window, settled however the pass ends.
  const loroWindow = createDocumentSyncLoroWindow();
  try {
    await runCapturedDocumentSyncPass({
      attachmentGeneration,
      currentDoc,
      encapsulationKeyPair,
      generation,
      loroWindow,
      nextRecord,
      policyOperation,
      state,
    });
  } finally {
    await settleDocumentSyncLoroWindow(loroWindow, null);
  }
}

async function runCapturedDocumentSyncPass(input: {
  readonly attachmentGeneration: DocumentStoreSyncGeneration;
  readonly currentDoc: DocumentState;
  readonly encapsulationKeyPair: EncapsulationKeyPair;
  readonly generation: DocumentStoreSyncGeneration;
  readonly loroWindow: DocumentSyncLoroWindow;
  readonly nextRecord: DocumentRecord;
  readonly policyOperation: PrincipalPolicyOperation;
  readonly state: DocumentStoreState;
}) {
  const {
    attachmentGeneration,
    currentDoc,
    encapsulationKeyPair,
    generation,
    loroWindow,
    policyOperation,
    state,
  } = input;
  let { nextRecord } = input;
  const revalidation = await revalidateRemoteDocumentBeforeAttachments(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
    generation,
    policyOperation,
    loroWindow,
  );
  nextRecord = revalidation.nextRecord;
  if (!revalidation.canSyncAttachments) {
    return;
  }

  const attachmentResult = await syncPendingAttachments({
    attachmentGeneration,
    encapsulationKeyPair,
    generation,
    loroWindow,
    nextRecord,
    policyOperation,
    state,
  });
  // A refused bind may have pulled mid-pass; the rest of the pass syncs from
  // the record that pull left, or its responses would not apply.
  nextRecord = attachmentResult.nextRecord;
  if (state.pendingAttachments.length > 0) {
    return;
  }
  // A settled bind and the content update carrying its digest are two server
  // writes. Push the content in this same pass rather than re-arming a later
  // one, so a device lost between them is the only remaining window: peers
  // otherwise see the old digest against the new binding.

  nextRecord = await syncDocumentState(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
    generation,
    policyOperation,
    loroWindow,
  );

  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
    return;
  }

  if (!state.doc || !state.record) return;

  // Read before the pending check: when nothing is pending after it, every
  // op this version holds is on the server, so a detach can cite it.
  const view = captureSyncedDocumentView(state, state.doc);
  const pendingUpdates = await listPendingUpdates(state);
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
    return;
  }
  if (
    !view ||
    !canSyncDetachedAttachmentBindings(nextRecord, pendingUpdates.length)
  ) {
    return;
  }

  await syncDetachedAttachmentBindings(
    state,
    nextRecord,
    generation,
    policyOperation,
    view,
  );
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
  }
}

async function runScheduledSyncIteration(
  state: DocumentStoreState,
  syncLaneGeneration: DocumentStoreSyncLaneGeneration,
  policyOperation: PrincipalPolicyOperation,
) {
  if (!(await awaitInitializationForSync(state))) {
    return false;
  }
  if (!isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)) {
    return true;
  }

  if (!canRunScheduledSync(state)) {
    return true;
  }

  try {
    await runDocumentSyncPass(state, syncLaneGeneration, policyOperation);
    return true;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return false;
    }

    await reportAndRethrowKeyingVerificationError(
      error,
      state.runtime.util.reportSecurityIncident,
      {
        objectId: state.record?.documentId ?? state.localId,
        objectKind: "document",
        operation: "document.sync",
      },
    );

    throw error;
  }
}

async function runScheduledSyncLoop(
  state: DocumentStoreState,
  syncLaneGeneration: DocumentStoreSyncLaneGeneration,
  policyOperation: PrincipalPolicyOperation,
) {
  const syncingGeneration = captureDocumentStoreSyncGeneration(
    state,
    state.doc,
  );
  setDocumentSyncing(state, true);

  try {
    await runScheduledSyncIteration(state, syncLaneGeneration, policyOperation);
  } finally {
    if (
      syncingGeneration &&
      isDocumentStoreSyncGenerationCurrent(state, syncingGeneration) &&
      isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)
    ) {
      setDocumentSyncing(state, false);
    }
  }
}

export function registerDocumentStoreSyncLane(
  state: DocumentStoreState,
  getSyncLaneGeneration: () => DocumentStoreSyncLaneGeneration | null,
): DocumentSyncLane {
  return registerDocumentSyncLane({
    domainScope: state.runtime.state.domainScope,
    localId: state.localId,
    priority: () =>
      state.remoteUpdatePending || state.record?.snapshotEndVersion === ""
        ? -1
        : 0,
    logError: (message, error) => {
      // Read the runtime lazily: a store's runtime is replaced in place, and a
      // reference captured here would report into a torn-down host.
      const { log, logError } = state.runtime.util;
      // Return the host's result: both callbacks are declared `=> void` but may
      // be async, and the lane reporter only catches a rejection it is handed.
      return logError ? logError(message, error) : log(message);
    },
    run: (policyOperation) => {
      const syncLaneGeneration = getSyncLaneGeneration();
      if (!syncLaneGeneration) return Promise.resolve();
      const activeWork = getActiveDocumentRemoteWork(state);
      if (activeWork) {
        // Re-arm on settlement, not immediately: immediate re-requests would
        // spin this lane and starve other work while the HTTP request is held.
        void activeWork.then(() => {
          if (
            isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)
          ) {
            requestDocumentStoreSync(state);
          }
        });
        return Promise.resolve();
      }
      return runDocumentRemoteWork(state, () =>
        isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)
          ? runScheduledSyncLoop(state, syncLaneGeneration, policyOperation)
          : Promise.resolve(),
      );
    },
  });
}
