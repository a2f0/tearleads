import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { isRejectedDecodedProjection } from "@tearleads/validators/response";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { ContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import { settleOutgoingPassAndDecideReArm } from "../../../data/sync/outgoingUpdateSettlement";
import {
  createDocumentSyncLoroWindow,
  type DocumentSyncLoroWindow,
  documentSyncCommittedVersions,
  noteDocumentSyncLoroWorkFailed,
  readPullContinuation,
  runDocumentSyncLoroWork,
  settleDocumentSyncLoroWindow,
  shouldClearDocumentSyncFailureAfterPass,
} from "../../documents";
import type { PrincipalPolicyOperation } from "../../principals/principalPolicyService";
import { noteContainerMetadataDownloadDrained } from "./metadataDownloadCompletion";
import { applyIncomingContainerMetadataUpdates } from "./metadataIncomingUpdateIsolation";
import {
  containerMetadataPeerRebaser,
  isMetadataPeerRestorePullNeeded,
  settleMetadataPeerRestoreAfterSync,
  shouldDeferMetadataQueuedWrites,
} from "./metadataPeerRebase";
import {
  currentMetadataPullContinuation,
  hasCurrentContainerMetadataReadState,
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
} from "./metadataPersistence";
import {
  type ContainerMetadataSyncAttempt,
  type ContainerMetadataSyncRuntime,
  syncRemoteContainerMetadata,
} from "./metadataRemoteSync";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "./metadataStateIsolation";
import { logDeferredWriterPeerPage } from "./metadataSyncErrors";
import {
  resumedEarlierMetadataPull,
  shouldRequestContainerMetadataFollowup,
} from "./metadataSyncFollowup";
import { containerMetadataVerdictRecorder } from "./metadataSyncVerdicts";

export {
  hasContainerMetadataDocumentUpdateEvent,
  listContainerMetadataDocumentUpdateIds,
} from "./metadataEvents";
export {
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
  setContainerIconMetadataStateFromRuntime,
} from "./metadataPersistence";

import { invalidateContainerMetadataPullContinuation } from "./metadataPullContinuationInvalidation";
import {
  cleanupContainerMetadataRegistrationsOnFailure,
  discardUnacceptedContainerMetadataUpdateIds,
  preRegisterMaterializedContainerMetadataUpdateIds,
} from "./metadataSyncRegistrations";
import type {
  ContainerMetadataState,
  MissingContainerMetadataState,
  SyncedContainerMetadataState,
} from "./metadataTypes";

export {
  cleanupContainerMetadataRegistrationsOnFailure,
  preRegisterMaterializedContainerMetadataUpdateIds,
} from "./metadataSyncRegistrations";
export type { ContainerMetadataPatch } from "./metadataTypes";

export function settleContainerMetadataOutgoingPass(
  metadataState: ContainerMetadataState,
  attempt: ContainerMetadataSyncAttempt,
): boolean {
  const shouldReArmOutgoing = settleOutgoingPassAndDecideReArm(metadataState, {
    exhaustedPendingUpdateCount: attempt.synced.exhaustedPendingUpdateCount,
    outgoingUpdateCount: attempt.writesDeferred
      ? 0
      : attempt.outgoingUpdateCount,
    rekeyedUpdateCount: attempt.synced.rekeyedPendingUpdateIds.length,
    settledUpdateCount: attempt.synced.settledPendingUpdateIds.length,
    acceptedRecoveryBaseline: attempt.synced.acceptedRecoveryBaseline,
  });
  return (
    attempt.synced.hasDeferredPendingUpdates ||
    shouldReArmOutgoing ||
    attempt.synced.hasIncompletePull
  );
}

function resolveSyncedContainerMetadataWriterProjection(
  metadataState: ContainerMetadataState,
  synced: ContainerMetadataSyncAttempt["synced"],
): DocumentWriterProjectionResponse | null {
  const resolvedWriterProjection =
    synced.writerProjection ??
    (metadataState.metadataWriterProjection?.documentId ===
      synced.plan.documentId &&
    !isRejectedDecodedProjection(metadataState.metadataWriterProjection)
      ? metadataState.metadataWriterProjection
      : null);
  return resolvedWriterProjection &&
    resolvedWriterProjection.contentKeyBundle.contentKeyEpoch ===
      synced.plan.sourceContentKeyBundle.contentKeyEpoch &&
    resolvedWriterProjection.contentKeyBundle.linkSetManifestHash ===
      synced.plan.sourceContentKeyBundle.linkSetManifestHash &&
    resolvedWriterProjection.contentKeyBundle.targetHash ===
      synced.plan.sourceContentKeyBundle.targetHash &&
    resolvedWriterProjection.documentKekTargets.linkSetManifestHash ===
      synced.plan.documentKekTargets.linkSetManifestHash &&
    resolvedWriterProjection.documentKekTargets.documentKeyTargetHash ===
      synced.plan.documentKekTargets.documentKeyTargetHash
    ? resolvedWriterProjection
    : null;
}

function metadataRotationSnapshotProvider(
  metadataState: ContainerMetadataState,
): () => Promise<Uint8Array | null> {
  return async () => exportFullHistorySnapshot(metadataState.doc);
}

interface SyncContainerMetadataStateInput {
  forceReadSync?: boolean | undefined;
  isCurrent: () => boolean;
  /**
   * Register sent ids before the network await so early self echoes cannot arm
   * a redundant read-sync. Shared with {@link listContainerMetadataDocumentUpdateIds}.
   */
  locallyAcceptedUpdateIds?: Set<string> | undefined;
  metadataState: ContainerMetadataState;
  onDurableStateNeedsReload?: (() => void) | undefined;
  persistence: ContainerContentsPersistence;
  /** The sync pass's operation; its policy reads share one directory view. */
  policyOperation: PrincipalPolicyOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
}

async function requestContainerMetadataSync(input: {
  documentId: string;
  loroWindow: DocumentSyncLoroWindow;
  metadataState: ContainerMetadataState;
  pendingUpdates: readonly PendingUpdateRecord[];
  sentUpdateIds: string[];
  syncInput: SyncContainerMetadataStateInput;
}): Promise<ContainerMetadataSyncAttempt | null> {
  const { metadataState, sentUpdateIds, syncInput } = input;
  const { isCurrent, persistence, runtime } = syncInput;
  return cleanupContainerMetadataRegistrationsOnFailure(
    syncInput.locallyAcceptedUpdateIds,
    sentUpdateIds,
    () =>
      syncRemoteContainerMetadata({
        buildRotationSnapshot: metadataRotationSnapshotProvider(metadataState),
        containerId: metadataState.container.id,
        currentDocument: metadataState.doc,
        deferQueuedWrites:
          input.pendingUpdates.length > 0 &&
          shouldDeferMetadataQueuedWrites(syncInput.metadataState),
        documentId: input.documentId,
        isCurrent,
        lastCommitLsn: metadataState.record.lastCommitLsn,
        localVersionVector: encodeVersionVector(metadataState.doc),
        loroWindow: input.loroWindow,
        onOutgoingUpdatesMaterialized: (updateIds) => {
          if (isCurrent()) {
            preRegisterMaterializedContainerMetadataUpdateIds(
              syncInput.locallyAcceptedUpdateIds,
              sentUpdateIds,
              updateIds,
            );
          }
        },
        onPullContinuationInvalidated: (continuation) =>
          invalidateContainerMetadataPullContinuation({
            continuation,
            isCurrent,
            metadataState,
            persistence,
            runtime,
          }),
        pendingUpdates: input.pendingUpdates,
        persistedState: metadataState.record,
        policyOperation: syncInput.policyOperation,
        pullContinuation:
          currentMetadataPullContinuation(metadataState) ?? undefined,
        rebaseOntoFreshPeer: containerMetadataPeerRebaser({
          execSql: runtime.infra.execSql,
          isCurrent,
          metadataState: syncInput.metadataState,
          onPullNeeded: () => syncInput.onDurableStateNeedsReload?.(),
          onRebased: () => syncInput.onDurableStateNeedsReload?.(),
          persistence,
        }),
        rekeyPendingUpdate: persistence.rekeyPendingUpdate,
        resolveProjectionUserKey: syncInput.resolveProjectionUserKey,
        runtime,
        targetSecretKey: syncInput.targetSecretKey,
        writerProjection:
          metadataState.metadataWriterProjection?.documentId ===
            input.documentId &&
          !isRejectedDecodedProjection(metadataState.metadataWriterProjection)
            ? metadataState.metadataWriterProjection
            : undefined,
      }),
  );
}

export async function syncContainerMetadataState(
  input: SyncContainerMetadataStateInput,
): Promise<
  SyncedContainerMetadataState | MissingContainerMetadataState | null
> {
  const { persistence, runtime } = input;
  const liveMetadataState = input.metadataState;
  const { isCurrent } = input;
  if (!isCurrent()) {
    return null;
  }
  const { documentId } = liveMetadataState.record;
  if (!documentId) {
    return null;
  }
  const execSql = runtime.infra.execSql;

  const pendingUpdates = await persistence.listPendingUpdates(
    execSql,
    liveMetadataState.container.id,
  );
  if (!isCurrent()) {
    return null;
  }
  const hasActivePendingUpdates =
    pendingUpdates.length > 0 &&
    !shouldDeferMetadataQueuedWrites(liveMetadataState);
  if (
    !hasActivePendingUpdates &&
    !isMetadataPeerRestorePullNeeded(liveMetadataState) &&
    currentMetadataPullContinuation(liveMetadataState) === null &&
    !liveMetadataState.record.pullContinuationRecoveryRequired &&
    !input.forceReadSync &&
    hasCurrentContainerMetadataReadState(liveMetadataState.record)
  ) {
    return null;
  }
  const metadataState =
    await createDetachedContainerMetadataState(liveMetadataState);
  if (!isCurrent()) {
    return null;
  }
  // The pass reads served updates with Loro only inside this window, which
  // the save closes; a pass that ends without one settles it here (#3194).
  const loroWindow = createDocumentSyncLoroWindow();
  try {
    return await syncDetachedContainerMetadataState(input, {
      documentId,
      liveMetadataState,
      loroWindow,
      metadataState,
      pendingUpdates,
    });
  } finally {
    await settleDocumentSyncLoroWindow(loroWindow, null);
  }
}

async function syncDetachedContainerMetadataState(
  input: SyncContainerMetadataStateInput,
  pass: {
    readonly documentId: string;
    readonly liveMetadataState: ContainerMetadataState;
    readonly loroWindow: DocumentSyncLoroWindow;
    readonly metadataState: Awaited<
      ReturnType<typeof createDetachedContainerMetadataState>
    >;
    readonly pendingUpdates: readonly PendingUpdateRecord[];
  },
): Promise<
  SyncedContainerMetadataState | MissingContainerMetadataState | null
> {
  const { persistence, runtime, isCurrent } = input;
  const { documentId, liveMetadataState, loroWindow, metadataState } = pass;
  const sentUpdateIds: string[] = [];

  const syncAttempt = await requestContainerMetadataSync({
    documentId,
    loroWindow,
    metadataState,
    pendingUpdates: pass.pendingUpdates,
    sentUpdateIds,
    syncInput: input,
  });
  if (!syncAttempt) {
    return null;
  }
  if (!isCurrent()) {
    discardUnacceptedContainerMetadataUpdateIds(
      input.locallyAcceptedUpdateIds,
      sentUpdateIds,
      [],
    );
    return null;
  }
  const verdicts = containerMetadataVerdictRecorder(
    metadataState.container.id,
    syncAttempt.synced,
    loroWindow,
  );
  const finalized = await finalizeContainerMetadataSync({
    documentId,
    isCurrent,
    liveMetadataState,
    locallyAcceptedUpdateIds: input.locallyAcceptedUpdateIds,
    loroWindow,
    metadataState,
    onDurableStateNeedsReload: input.onDurableStateNeedsReload,
    persistence,
    runtime,
    sentUpdateIds,
    syncAttempt,
    verdicts,
  });
  if (!isCurrent() || !finalized) {
    return null;
  }
  if (!("missing" in finalized)) {
    installDetachedContainerMetadataState(liveMetadataState, metadataState, {
      preserveConcurrentMetadataEdit: true,
    });
  }
  return finalized;
}

async function finalizeContainerMetadataSync(input: {
  documentId: string;
  isCurrent: () => boolean;
  liveMetadataState: ContainerMetadataState;
  locallyAcceptedUpdateIds: Set<string> | undefined;
  loroWindow: DocumentSyncLoroWindow;
  metadataState: ContainerMetadataState;
  onDurableStateNeedsReload?: (() => void) | undefined;
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataSyncRuntime;
  sentUpdateIds: readonly string[];
  syncAttempt: ContainerMetadataSyncAttempt;
  verdicts: ReturnType<typeof containerMetadataVerdictRecorder>;
}): Promise<
  SyncedContainerMetadataState | MissingContainerMetadataState | null
> {
  const { metadataState, syncAttempt, verdicts } = input;
  const { synced } = syncAttempt;
  const discardAllSent = () =>
    discardUnacceptedContainerMetadataUpdateIds(
      input.locallyAcceptedUpdateIds,
      input.sentUpdateIds,
      [],
    );
  if (!input.isCurrent()) {
    discardAllSent();
    return null;
  }
  // An id sent but not accepted will never be echoed. Accepted ids stay
  // registered until their realtime echo consumes them.
  discardUnacceptedContainerMetadataUpdateIds(
    input.locallyAcceptedUpdateIds,
    input.sentUpdateIds,
    synced.response.acceptedOutgoingUpdateIds,
  );
  metadataState.metadataWriterProjection =
    resolveSyncedContainerMetadataWriterProjection(metadataState, synced);
  if (
    synced.decryptedUpdates.length > 0 &&
    !runDocumentSyncLoroWork(input.loroWindow, () =>
      applyIncomingContainerMetadataUpdates(metadataState.doc, synced),
    )
  ) {
    // Nothing of the page was imported or saved.
    discardAllSent();
    logDeferredWriterPeerPage(input.runtime, metadataState.container.id);
    return null;
  }
  const persisted = await saveContainerMetadataPage(input);
  // A save that lost currency at commit returns null: it rolled back.
  await verdicts.settleWindow(input.runtime.infra.execSql, {
    committed: persisted !== null,
  });
  if (!input.isCurrent()) {
    discardAllSent();
    return null;
  }
  if (!persisted) {
    discardAllSent();
    metadataState.metadataWriterProjection = null;
    return { missing: true };
  }
  metadataState.container = persisted.container;
  installContainerMetadataRecord(metadataState, persisted.record);
  if (persisted.pullContinuationSuperseded) {
    // The response's accepted IDs were not durably settled. Treat every
    // pre-registration as unapplied so an early echo cannot hide work that the
    // forced follow-up still needs to reconcile.
    discardAllSent();
    metadataState.metadataWriterProjection = null;
  } else {
    noteContainerMetadataDownloadDrained({
      container: persisted.container,
      domainScope: input.runtime.state.domainScope,
      pullIncomplete: synced.hasIncompletePull || synced.hasHeldPull,
      storedRecord: persisted.record,
      syncAttempt,
    });
  }
  // A superseded save ran no recorder; the next pull judges its page again.
  verdicts.settle(input.runtime.util.logError);

  const unparked =
    !persisted.pullContinuationSuperseded &&
    settleMetadataPeerRestoreAfterSync({
      metadataState: input.liveMetadataState,
      outgoingUpdateCount: syncAttempt.outgoingUpdateCount,
      pullComplete: !synced.hasIncompletePull && !synced.hasHeldPull,
      pullPage: synced.response.pullPage,
      settledPendingUpdateCount: synced.settledPendingUpdateIds.length,
      writesDeferred: syncAttempt.writesDeferred,
    });
  return {
    ...persisted,
    ...(resumedEarlierMetadataPull(syncAttempt)
      ? { resumedEarlierPull: true as const }
      : {}),
    shouldRequestFollowupSync:
      unparked ||
      shouldRequestContainerMetadataFollowup({
        persisted,
        settleOutgoingPass: () =>
          settleContainerMetadataOutgoingPass(metadataState, syncAttempt),
      }),
  };
}

/** Saves the page's result, recording verdicts and closing its Loro window. */
async function saveContainerMetadataPage(
  input: Parameters<typeof finalizeContainerMetadataSync>[0],
) {
  const { metadataState, syncAttempt, verdicts } = input;
  const { outgoingUpdateCount, synced } = syncAttempt;
  try {
    return await persistContainerMetadataStateFromRuntime({
      acceptedPendingUpdateIds: synced.settledPendingUpdateIds,
      clearSyncFailure: shouldClearDocumentSyncFailureAfterPass(
        synced,
        outgoingUpdateCount,
        syncAttempt.writesDeferred === true,
      ),
      commitSideEffect: verdicts.commitSideEffect,
      committedVersions: documentSyncCommittedVersions(
        synced,
        metadataState.doc,
      ),
      expectedSyncState: {
        pullContinuation: syncAttempt.consumedPullContinuation ?? null,
        record: syncAttempt.requestRecord,
      },
      metadataState,
      onDurableStateNeedsReload: input.onDurableStateNeedsReload,
      patch: {
        ...synced.persistedState,
        documentId: input.documentId,
        lastCommitLsn:
          synced.response.commitLsn ??
          metadataState.record.lastCommitLsn ??
          null,
        metadataDocumentId: input.documentId,
        pullContinuation: readPullContinuation(
          synced.response,
          synced.baselineGroupRun,
        ),
      },
      persistence: input.persistence,
      runtime: input.runtime,
      stillCurrent: input.isCurrent,
    });
  } catch (error) {
    noteDocumentSyncLoroWorkFailed(input.loroWindow);
    throw error;
  }
}
