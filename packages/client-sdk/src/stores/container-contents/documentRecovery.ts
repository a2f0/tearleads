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
  type ContainerContentsWorkflowRuntime,
  createContainerContentsDocumentsRuntime,
} from "../../workflows/container-contents/runtime";
import { openDocumentStore } from "../documents";

type PrimeDocumentRuntime = ReturnType<
  typeof createContainerContentsDocumentsRuntime
>;

interface DocumentRecoveryStoreState {
  readonly containersById: Map<string, ContainerState>;
  documentStoresNeedPriming: boolean;
  readonly logLabel?: string | undefined;
  readonly persistence: ContainerContentsPersistence;
  readonly runtime: ContainerContentsWorkflowRuntime;
}

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
      `${logLabel(state)}: document priming candidates=${result.candidateCount} roots=${result.rootCount} primed=${result.primedCount} unroutable=${result.unroutableCount}`,
    );
  } catch (error) {
    state.documentStoresNeedPriming = true;
    throw error;
  }
}
