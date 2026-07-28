import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import {
  primeDocumentsForContainerSubtree,
  primeDocumentsForLoadedRoots,
} from "../../workflows/container-contents/documentPriming";
import type {
  ContainerDocumentPrimeHost,
  ContainerDocumentPrimeStore,
} from "../../workflows/container-contents/documentQueries/types";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import {
  type ContainerContentsStoreWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
} from "../../workflows/container-contents/runtime";
import type { StaleRootRecoveryStatus } from "../../workflows/container-contents/staleRootRecovery";
import { recoverStaleSessionRoot } from "../../workflows/container-contents/staleRootRecovery";
import { isDatabaseUnavailableError } from "../../workflows/container-contents/syncLane";
import { openDocumentStore } from "../documents";

type PrimeDocumentRuntime = ReturnType<
  typeof createContainerContentsDocumentsRuntime
>;

interface DocumentRecoveryStoreState {
  readonly containersById: Map<string, ContainerState>;
  documentStoresNeedPriming: boolean;
  readonly logLabel?: string | undefined;
  readonly persistence: ContainerContentsPersistence;
  readonly rootLaneHydrated: boolean;
  readonly runtime: ContainerContentsStoreWorkflowRuntime;
}

interface StaleRootRecoveryLogState {
  readonly message: string;
  readonly occurrenceCount: number;
}

const staleRootRecoveryLogState = new WeakMap<
  DocumentRecoveryStoreState,
  StaleRootRecoveryLogState
>();
const rejectedAdoptionRuntime = new WeakMap<
  DocumentRecoveryStoreState,
  ContainerContentsStoreWorkflowRuntime
>();

function createPrimeHost(
  state: DocumentRecoveryStoreState,
): ContainerDocumentPrimeHost<PrimeDocumentRuntime> {
  return {
    documentWorkflowRuntime: (containerId) =>
      createContainerContentsDocumentsRuntime(state.runtime, containerId),
    openDocumentStore: ({
      documentId,
      localId,
      runtime,
    }): ContainerDocumentPrimeStore =>
      openDocumentStore(
        state.runtime.state.domainScope,
        localId,
        runtime,
        documentId,
      ),
  };
}

function logLabel(state: DocumentRecoveryStoreState): string {
  return state.logLabel ?? "Container contents";
}

export async function primeStoreDocumentSubtree(
  state: DocumentRecoveryStoreState,
  rootContainerId: string,
): Promise<void> {
  await primeDocumentsForContainerSubtree({
    containersById: state.containersById,
    host: createPrimeHost(state),
    rootContainerId,
    runtime: state.runtime,
  });
}

export async function primeStoreDocuments(
  state: DocumentRecoveryStoreState,
): Promise<void> {
  // Consume the current signal before scanning. A topology/root reconciliation
  // that lands during an awaited query can then re-arm the next pass without
  // this pass erasing that newer signal when it completes.
  state.documentStoresNeedPriming = false;
  try {
    const result = await primeDocumentsForLoadedRoots({
      containersById: state.containersById,
      host: createPrimeHost(state),
      runtime: state.runtime,
    });
    state.runtime.util.log(
      `${logLabel(state)}: document priming candidates=${result.candidateCount} roots=${result.rootCount} primed=${result.primedCount} orphaned=${result.orphanPrimedCount} unroutable=${result.unroutableCount}`,
    );
  } catch (error) {
    state.documentStoresNeedPriming = true;
    throw error;
  }
}

export async function recoverStoreStaleRoot(
  state: DocumentRecoveryStoreState,
): Promise<StaleRootRecoveryStatus> {
  const runtime = state.runtime;
  if (rejectedAdoptionRuntime.get(state) === runtime) {
    return "not-needed";
  }

  let result: Awaited<ReturnType<typeof recoverStaleSessionRoot>>;
  try {
    result = await recoverStaleSessionRoot({ ...state, runtime });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      throw error;
    }
    const message = `${logLabel(state)}: stale root recovery failed`;
    if (state.runtime.util.logError) {
      state.runtime.util.logError(message, error);
    } else {
      state.runtime.util.log(message);
    }
    return "not-needed";
  }
  const message = `${logLabel(state)}: stale root recovery status=${result.status} candidates=${result.candidateCount}`;
  const previousLogState = staleRootRecoveryLogState.get(state);
  const occurrenceCount =
    previousLogState?.message === message
      ? previousLogState.occurrenceCount + 1
      : 1;
  staleRootRecoveryLogState.set(state, { message, occurrenceCount });
  if (result.status !== "not-needed") {
    if (occurrenceCount === 1) {
      runtime.util.log(message);
    } else if ((occurrenceCount & (occurrenceCount - 1)) === 0) {
      runtime.util.log(`${message} occurrences=${occurrenceCount}`);
    }
  }
  if (result.status === "context-changed") {
    rejectedAdoptionRuntime.set(state, runtime);
  } else {
    rejectedAdoptionRuntime.delete(state);
  }
  if (result.reassigned) {
    state.documentStoresNeedPriming = true;
  }
  return result.status;
}
