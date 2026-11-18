import type { ContainerContentsStoreWorkflowRuntime } from "../../../workflows/container-contents/runtime";

export interface ContainerStoreScope {
  runtime: Pick<ContainerContentsStoreWorkflowRuntime, "liveHydrationStatus">;
  syncLane?: { isDisposed?: () => boolean } | null;
}

/** The host can retire a store without delivering another runtime update. */
export function ownsContainerStore(state: ContainerStoreScope): boolean {
  return (
    !state.syncLane?.isDisposed?.() &&
    state.runtime.liveHydrationStatus?.() !== "retired"
  );
}
