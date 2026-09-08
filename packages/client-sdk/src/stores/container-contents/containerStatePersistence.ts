import {
  installContainerMetadataRecord,
  persistContainerMetadataStateFromRuntime,
} from "../../workflows/container-contents/metadata";
import type { PersistContainerStateResult } from "../../workflows/container-contents/remoteHydration";
import { removeMissingContainerState } from "./missingContainerState";
import { updateContainerContentsSnapshot } from "./state";
import type { ContainerState } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

type MetadataPersistenceInput = Parameters<
  typeof persistContainerMetadataStateFromRuntime
>[0];

interface PersistContainerStateOptions
  extends Pick<
    MetadataPersistenceInput,
    | "patch"
    | "saveOptions"
    | "localMetadataPatch"
    | "localUpdate"
    | "createIntentSettlement"
    | "moveIntentSettlement"
    | "preserveDurableStructureWhenPending"
  > {
  expectedStateWhenMissing?: ContainerState | undefined;
  isCurrent?: (() => boolean) | undefined;
  updateView?: boolean | undefined;
}

export async function persistContainerState(
  state: ContainerContentsStoreState,
  containerState: ContainerState,
  options: PersistContainerStateOptions = {},
): Promise<PersistContainerStateResult> {
  const { expectedStateWhenMissing, isCurrent, updateView = true } = options;
  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: containerState,
    localMetadataPatch: options.localMetadataPatch,
    localUpdate: options.localUpdate,
    patch: options.patch ?? {},
    persistence: state.persistence,
    createIntentSettlement: options.createIntentSettlement,
    moveIntentSettlement: options.moveIntentSettlement,
    preserveDurableStructureWhenPending:
      options.preserveDurableStructureWhenPending,
    runtime: state.runtime,
    saveOptions: options.saveOptions,
    stillCurrent: isCurrent,
  });
  if (isCurrent?.() === false) {
    return { status: "stale-generation" };
  }
  if (!persisted) {
    removeMissingContainerState(
      state,
      expectedStateWhenMissing ?? containerState,
    );
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
  return {
    record: persisted.record,
    status: "persisted",
    ...(persisted.createIntentSettled
      ? { createIntentSettled: true as const }
      : {}),
    ...(persisted.moveIntentSettled
      ? { moveIntentSettled: true as const }
      : {}),
  };
}
