import type { ContainerContentsStoreState } from "./types";

export type ContainerWriteGuard = () => boolean;

export function captureContainerWriteGeneration(
  state: ContainerContentsStoreState,
): ContainerWriteGuard {
  const lifecycleGeneration = state.lifecycleGeneration;
  const structuralGeneration = state.structuralGeneration;
  return () =>
    state.lifecycleGeneration === lifecycleGeneration &&
    state.structuralGeneration === structuralGeneration;
}
