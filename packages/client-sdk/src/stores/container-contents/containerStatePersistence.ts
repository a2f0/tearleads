import {
  type ContainerMetadataPatch,
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
} from "../../workflows/container-contents/metadata";
import type { PersistContainerStateResult } from "../../workflows/container-contents/remoteHydration";
import { removeMissingContainerState } from "./missingContainerState";
import { updateContainerContentsSnapshot } from "./state";
import type { ContainerState } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

type PersistContainerSaveOptions = Parameters<
  typeof persistContainerMetadataStateFromRuntime
>[0]["saveOptions"];
type LocalContainerMetadataMutation = Pick<
  Parameters<typeof persistContainerMetadataStateFromRuntime>[0],
  "localMetadataPatch" | "localUpdate"
>;
type ContainerMetadataMutationOptions = Pick<
  Parameters<typeof persistContainerMetadataStateFromRuntime>[0],
  "preserveDurableStructureWhenPending"
>;
type ContainerStateMutationOptions = ContainerMetadataMutationOptions & {
  isCurrent?: (() => boolean) | undefined;
};

export async function persistContainerState(
  state: ContainerContentsStoreState,
  containerState: ContainerState,
  patch: Partial<ContainerMetadataPatch> = {},
  updateView = true,
  saveOptions?: PersistContainerSaveOptions,
  localMutation?: LocalContainerMetadataMutation,
  mutationOptions?: ContainerStateMutationOptions,
): Promise<PersistContainerStateResult> {
  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: containerState,
    localMetadataPatch: localMutation?.localMetadataPatch,
    localUpdate: localMutation?.localUpdate,
    patch,
    persistence: state.persistence,
    preserveDurableStructureWhenPending:
      mutationOptions?.preserveDurableStructureWhenPending,
    runtime: state.runtime,
    saveOptions,
  });
  if (mutationOptions?.isCurrent?.() === false) {
    return { status: "stale-generation" };
  }
  if (!persisted) {
    removeMissingContainerState(state, containerState);
    return { status: "missing" };
  }
  containerState.container = persisted.container;
  installContainerMetadataRecord(containerState, persisted.record);
  if (persisted.mutationSuperseded || persisted.syncIdentitySuperseded) {
    const cachedState = state.containersById.get(containerState.container.id);
    if (cachedState && cachedState !== containerState) {
      cachedState.container = containerState.container;
      cachedState.doc = containerState.doc;
      cachedState.metadataWriterProjection =
        containerState.metadataWriterProjection;
      installContainerMetadataRecord(cachedState, persisted.record);
    }
    // The requested structural mutation was not applied. Refresh from the
    // authoritative state installed above, but make the caller fail explicitly
    // so it cannot schedule sync or report the dropped mutation as successful.
    updateContainerContentsSnapshot(state);
    return { record: persisted.record, status: "identity-superseded" };
  }
  if (updateView) {
    updateContainerContentsSnapshot(state);
  }
  return { record: persisted.record, status: "persisted" };
}
