import { syncPendingContainerCreateIntents } from "../../../workflows/container-contents/container-state/create/createIntentSync";
import { syncPendingContainerMoveIntents } from "../../../workflows/container-contents/container-state/move/moveIntentSync";
import type {
  ContainerMetadataRevalidation,
  ExecSql,
} from "../../../workflows/container-contents/containerPersistence";
import {
  type DocumentMoveIntentSyncHost,
  syncPendingDocumentMoveIntents,
} from "../../../workflows/container-contents/documentMove/documentMoveIntentSync";
import { syncContainerMetadataState } from "../../../workflows/container-contents/metadata";
import type { SyncedContainerMetadataState } from "../../../workflows/container-contents/metadata/metadataTypes";
import type {
  ContainerState,
  RemoteContainerHydrationHost,
} from "../../../workflows/container-contents/remoteHydration";
import { createContainerContentsDocumentsRuntime } from "../../../workflows/container-contents/runtime";
import type { PrincipalPolicyOperation } from "../../../workflows/principals/principalPolicyService";
import { openDocumentStore, requestDomainDocumentSync } from "../../documents";
import { relinkDocumentStoreWithCommitSideEffect } from "../../documents/documentStore/internalRelink";
import { DocumentRemoteWorkBusyError } from "../../documents/documentStore/sync/remoteWork";
import { removeMissingSyncedContainerState } from "../containerState/missingSyncedContainerState";
import { runContainerDocumentWork } from "../documentWork";
import {
  primeStoreDocuments,
  recoverStoreStaleRoot,
} from "../documentWork/documentRecovery";
import { createAcceptedMoveRetry } from "./acceptedMoveRetry";
import {
  coversAdvertisedMetadataVersion,
  findOwedContainerMetadataRead,
  restoreOwedContainerMetadataReads,
  settleOwedContainerMetadataRead,
} from "./metadataRevalidation";
import {
  bumpMetadataSyncSeq,
  clearMetadataSyncQueueIfUnchanged,
  readMetadataSyncSeq,
} from "./metadataSyncSignal";
import type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncState,
} from "./syncAgentTypes";

type ContainerContentsStorePrimeDocumentRuntime = ReturnType<
  typeof createContainerContentsDocumentsRuntime
>;
type SyncContainerMetadata = typeof syncContainerMetadataState;

function requestContainerContentsStoreSync(
  state: ContainerContentsStoreSyncState,
) {
  state.syncLane?.requestSync();
}

function createRemoteSyncBlocker(runtime: ContainerContentsStoreRuntime) {
  return (organizationId: string) =>
    runtime.util.isRemoteSyncBlocked?.(organizationId) ?? false;
}

function captureStructuralSyncGeneration(
  state: ContainerContentsStoreSyncState,
  runtime: ContainerContentsStoreRuntime,
) {
  const activeContainerId = runtime.state.containerId;
  const activeOrganizationId = runtime.auth.organizationId;
  const lifecycleGeneration = state.lifecycleGeneration;
  const structuralGeneration = state.structuralGeneration;
  const domainScope = runtime.state.domainScope;
  const execSql = runtime.infra.execSql;
  const resolveProjectionUserKey = state.resolveProjectionUserKey;
  const syncLane = state.syncLane;
  return () =>
    state.lifecycleGeneration === lifecycleGeneration &&
    state.structuralGeneration === structuralGeneration &&
    state.runtime.auth.organizationId === activeOrganizationId &&
    state.runtime.state.containerId === activeContainerId &&
    state.runtime.state.domainScope === domainScope &&
    state.runtime.infra.execSql === execSql &&
    state.resolveProjectionUserKey === resolveProjectionUserKey &&
    state.syncLane === syncLane &&
    !syncLane?.isDisposed?.();
}

function createContainerContentsStoreDocumentMoveHost(
  state: ContainerContentsStoreSyncState,
  isCurrent: () => boolean,
): DocumentMoveIntentSyncHost<ContainerContentsStorePrimeDocumentRuntime> {
  const runtime = state.runtime;
  const domainScope = runtime.state.domainScope;
  return {
    documentWorkflowRuntime: (containerId) =>
      createContainerContentsDocumentsRuntime(runtime, containerId),
    openDocumentStore: ({ containerId, documentId, localId }) => {
      const store = openDocumentStore(
        domainScope,
        localId,
        createContainerContentsDocumentsRuntime(runtime, containerId),
        documentId,
      );
      return {
        assertCanRotateContentKey: (proof) =>
          store.assertCanRotateContentKey(proof).catch((error: unknown) => {
            if (error instanceof DocumentRemoteWorkBusyError) {
              void error.whenIdle.then(() => {
                if (isCurrent()) requestContainerContentsStoreSync(state);
              });
            }
            throw error;
          }),
        ensureInitialized: () => store.ensureInitialized(),
        relink: ({ commitSideEffect, ...input }) =>
          commitSideEffect
            ? relinkDocumentStoreWithCommitSideEffect(
                store,
                input,
                commitSideEffect,
              )
            : store.relink(input),
        requestSync: () => store.requestSync(),
        updateRuntime: (nextRuntime) => store.updateRuntime(nextRuntime),
      };
    },
  };
}

function syncPendingStoreDocumentMoves(input: {
  isCreatePending: (containerId: string) => boolean;
  isCurrent: () => boolean;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  state: ContainerContentsStoreSyncState;
}) {
  return syncPendingDocumentMoveIntents({
    host: createContainerContentsStoreDocumentMoveHost(
      input.state,
      input.isCurrent,
    ),
    isCreatePending: input.isCreatePending,
    isCurrent: input.isCurrent,
    isRemoteSyncBlocked: input.isRemoteSyncBlocked,
    state: input.state,
  });
}

function syncPendingStoreContainerMoves(
  input: Omit<
    Parameters<typeof syncPendingContainerMoveIntents>[0],
    "acceptedMoveRetry" | "state"
  > & { state: ContainerContentsStoreSyncState },
) {
  return syncPendingContainerMoveIntents({
    ...input,
    acceptedMoveRetry: createAcceptedMoveRetry(input.state),
  });
}

async function syncSingleContainerMetadata(input: {
  host: RemoteContainerHydrationHost;
  isCurrent: () => boolean;
  state: ContainerContentsStoreSyncState;
  containerState: ContainerState;
  encapsulationKeyPair: NonNullable<
    ContainerContentsStoreRuntime["crypto"]["encapsulationKeyPair"]
  >;
  policyOperation: PrincipalPolicyOperation;
  syncContainerMetadata?: SyncContainerMetadata | undefined;
}) {
  const { containerState, encapsulationKeyPair, host, isCurrent, state } =
    input;
  const metadataDocumentId = containerState.record.documentId;
  const readExecSql = state.runtime.infra.execSql;
  // The durable request this read answers, read before the read begins.
  const owedRead =
    typeof metadataDocumentId === "string" &&
    state.metadataDocumentIdsNeedingSync.has(metadataDocumentId)
      ? await findOwedContainerMetadataRead(state, {
          documentId: metadataDocumentId,
          execSql: readExecSql,
        })
      : null;
  if (!isCurrent()) return;
  // Snapshot this signal before the GET so a mid-pass event survives clearing.
  const consumedSeqById = new Map<string, number>();
  if (typeof metadataDocumentId === "string") {
    consumedSeqById.set(
      metadataDocumentId,
      readMetadataSyncSeq(state.metadataSyncSignalSeqById, metadataDocumentId),
    );
  }
  const synced = await (
    input.syncContainerMetadata ?? syncContainerMetadataState
  )({
    forceReadSync:
      typeof metadataDocumentId === "string" &&
      state.metadataDocumentIdsNeedingSync.has(metadataDocumentId),
    locallyAcceptedUpdateIds: state.locallyAcceptedMetadataUpdateIds,
    isCurrent,
    metadataState: containerState,
    onDurableStateNeedsReload: () => {
      const currentDocumentId = state.containersById.get(
        containerState.container.id,
      )?.record.documentId;
      if (typeof currentDocumentId === "string") {
        state.metadataDocumentIdsNeedingSync.add(currentDocumentId);
        bumpMetadataSyncSeq(state.metadataSyncSignalSeqById, currentDocumentId);
      }
      requestContainerContentsStoreSync(state);
    },
    persistence: state.persistence,
    policyOperation: input.policyOperation,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!isCurrent() || !synced) {
    return;
  }
  if ("missing" in synced) {
    removeMissingSyncedContainerState(
      state,
      containerState,
      host.updateSnapshot,
    );
    return;
  }

  const kept = keptMetadataSignals({ containerState, owedRead, synced });
  const stillCurrent = await settleConsumedMetadataSignals({
    consumedSeqById,
    documentIds: [metadataDocumentId, synced.record.documentId],
    isCurrent,
    keepsSignals: kept.keep,
    owedRead,
    readExecSql,
    state,
  });
  // A reset can land after the settlement's last check and before this resumes.
  if (!stillCurrent || !isCurrent()) return;
  // syncContainerMetadataState settles its detached candidate into this live
  // object while preserving any metadata edit that completed or queued during
  // the remote pass. Do not install its returned detached record again here:
  // doing so would overwrite that preserved live edit.
  host.updateSnapshot();

  // A pass that kept an owed read hands it to a fresh read next pass.
  if (
    synced.shouldRequestFollowupSync ||
    (kept.followUp && isQueuedForRead(state, metadataDocumentId))
  ) {
    requestContainerContentsStoreSync(state);
  }
}

/**
 * Whether a completed read keeps its signals for another read, and whether to
 * ask for that read now. A resumed pull reads only to its earlier bound, and a
 * superseded result discarded what it pulled: both hand the read to a fresh
 * pass. A replica lagging the listing can answer without the advertised edit;
 * that debt waits for a later pass rather than a follow-up loop.
 */
function keptMetadataSignals(input: {
  containerState: ContainerState;
  owedRead: ContainerMetadataRevalidation | null;
  synced: SyncedContainerMetadataState;
}): { followUp: boolean; keep: boolean } {
  const followUp =
    input.synced.resumedEarlierPull === true ||
    isSupersededMetadataSync(input.synced);
  const behindListing =
    input.owedRead !== null &&
    !coversAdvertisedMetadataVersion(input.containerState.doc, input.owedRead);
  return { followUp, keep: followUp || behindListing };
}

function isSupersededMetadataSync(
  synced: Pick<
    SyncedContainerMetadataState,
    | "mutationSuperseded"
    | "pullContinuationSuperseded"
    | "syncIdentitySuperseded"
  >,
): boolean {
  return (
    synced.mutationSuperseded === true ||
    synced.pullContinuationSuperseded === true ||
    synced.syncIdentitySuperseded === true
  );
}

function isQueuedForRead(
  state: ContainerContentsStoreSyncState,
  documentId: string | null | undefined,
): boolean {
  return (
    typeof documentId === "string" &&
    state.metadataDocumentIdsNeedingSync.has(documentId)
  );
}

/**
 * Clears the signals a completed metadata sync consumed and settles the read a
 * listing owed: the sync pulled every update this client lacked, unless a
 * newer signal queued the document again. A pass that keeps its signals
 * settles nothing. Returns false once the pass is no longer current, before
 * touching a replacement store's queue.
 */
async function settleConsumedMetadataSignals(input: {
  consumedSeqById: ReadonlyMap<string, number>;
  documentIds: ReadonlyArray<string | null | undefined>;
  isCurrent: () => boolean;
  keepsSignals: boolean;
  owedRead: ContainerMetadataRevalidation | null;
  readExecSql: ExecSql;
  state: ContainerContentsStoreSyncState;
}): Promise<boolean> {
  if (input.keepsSignals) return true;
  for (const id of new Set(input.documentIds)) {
    if (typeof id !== "string") continue;
    if (!input.isCurrent()) return false;
    clearMetadataSyncQueueIfUnchanged({
      consumedSeqById: input.consumedSeqById,
      id,
      needingSync: input.state.metadataDocumentIdsNeedingSync,
      seqById: input.state.metadataSyncSignalSeqById,
    });
  }
  if (input.owedRead) {
    await settleOwedContainerMetadataRead(input.state, {
      execSql: input.readExecSql,
      revalidation: input.owedRead,
    });
  }
  return input.isCurrent();
}

/**
 * Syncs each held container's metadata, after requeueing reads a previous run
 * still owed. Returns false once the pass is no longer current.
 */
async function syncEveryContainerMetadata(
  input: Omit<
    Parameters<typeof syncSingleContainerMetadata>[0],
    "containerState"
  > & {
    isCreatePending: (containerId: string) => boolean;
  },
): Promise<boolean> {
  const { isCurrent, state } = input;
  if (!state.owedMetadataReadsRestored) {
    await restoreOwedContainerMetadataReads(state, isCurrent);
    if (!isCurrent()) return false;
    state.owedMetadataReadsRestored = true;
  }
  for (const containerState of Array.from(state.containersById.values())) {
    if (input.isCreatePending(containerState.container.id)) continue;
    await syncSingleContainerMetadata({ ...input, containerState });
    if (!isCurrent()) return false;
  }
  return true;
}

/**
 * A folder whose create has not settled can carry a listed identity that
 * adoption has not verified, or has refused. Folder moves, document moves and
 * metadata edits wait for it; child and document creates wait in their own
 * create paths.
 */
async function loadPendingCreatePredicate(
  state: ContainerContentsStoreSyncState,
): Promise<(containerId: string) => boolean> {
  const pending = await state.persistence.listPendingCreateIntents(
    state.runtime.infra.execSql,
  );
  const pendingIds = new Set(pending.map((intent) => intent.containerId));
  return (containerId) => pendingIds.has(containerId);
}

interface ContainerContentsStoreSyncIterationInput {
  host: RemoteContainerHydrationHost;
  /** The drain's operation: every metadata sync of this pass shares it. */
  policyOperation: PrincipalPolicyOperation;
  reconcileRestoredAccess: (isCurrent: () => boolean) => Promise<void>;
  requestRemoteReconciliation: (parentContainerId: string | null) => void;
  state: ContainerContentsStoreSyncState;
  syncContainerMetadata?: SyncContainerMetadata | undefined;
}

export async function runContainerContentsStoreSyncIteration(
  input: ContainerContentsStoreSyncIterationInput,
) {
  const { host, reconcileRestoredAccess, requestRemoteReconciliation, state } =
    input;
  const runtime = state.runtime;
  const encapsulationKeyPair = runtime.crypto.encapsulationKeyPair;
  if (
    runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready ||
    !runtime.state.online ||
    !runtime.auth.isAuthenticated ||
    !encapsulationKeyPair
  ) {
    return;
  }
  const domainScope = runtime.state.domainScope;
  const isCurrent = captureStructuralSyncGeneration(state, runtime);

  await reconcileRestoredAccess(isCurrent);
  if (!isCurrent()) {
    return;
  }
  const isOrganizationBlocked = createRemoteSyncBlocker(runtime);

  const createdContainerCount = await syncPendingContainerCreateIntents({
    host,
    isCurrent,
    isRemoteSyncBlocked: isOrganizationBlocked,
    requestRemoteReconciliation,
    state,
  });
  if (!isCurrent()) {
    return;
  }
  if (createdContainerCount > 0) {
    state.documentStoresNeedPriming = true;
    host.updateSnapshot();
  }
  const isCreatePending = await loadPendingCreatePredicate(state);
  if (!isCurrent()) {
    return;
  }

  const movedContainerCount = await syncPendingStoreContainerMoves({
    host,
    isCreatePending,
    isCurrent,
    isRemoteSyncBlocked: isOrganizationBlocked,
    requestRemoteReconciliation,
    state,
  });
  if (!isCurrent()) {
    return;
  }
  if (movedContainerCount > 0) {
    state.documentStoresNeedPriming = true;
    host.updateSnapshot();
    requestDomainDocumentSync(domainScope);
    requestContainerContentsStoreSync(state);
  }

  const metadataSynced = await syncEveryContainerMetadata({
    ...input,
    encapsulationKeyPair,
    isCreatePending,
    isCurrent,
  });
  if (!metadataSynced) {
    return;
  }

  // Root adoption notifies session consumers synchronously. Let container
  // metadata converge first so a recovered system container is never exposed
  // under its placeholder name when the active root changes.
  await runContainerDocumentWork({
    isCurrent,
    onContextChanged: () => {
      if (isCurrent()) {
        requestContainerContentsStoreSync(state);
      }
    },
    onDocumentsMoved: () => {
      if (isCurrent()) {
        requestDomainDocumentSync(domainScope);
        requestContainerContentsStoreSync(state);
      }
    },
    primeDocuments: () => primeStoreDocuments(state, isCurrent),
    recoverStaleRoot: () => recoverStoreStaleRoot(state, isCurrent),
    shouldPrimeDocuments: () => state.documentStoresNeedPriming,
    // Document move intents live in the structural phase because they may
    // target containers created locally in the same session, such as Trash.
    // Root recovery rewrites stale endpoints and returns their intents to
    // pending, so replay follows recovery in this same pass.
    syncPendingDocumentMoves: () =>
      syncPendingStoreDocumentMoves({
        isCreatePending,
        isCurrent,
        isRemoteSyncBlocked: isOrganizationBlocked,
        state,
      }),
  });
}
