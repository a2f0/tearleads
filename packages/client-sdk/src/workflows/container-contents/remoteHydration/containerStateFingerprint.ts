import type { ContainerState } from "./types";

/**
 * Immutable request-time identity for one live container state. Hydration
 * mutates ContainerState objects in place, so retaining the object reference is
 * not enough to detect a newer local or remote commit while a page is fetched.
 */
export function createContainerStateFingerprint(state: ContainerState): string {
  return JSON.stringify([state.container, state.record]);
}

export function containerStateMatchesFingerprint(input: {
  currentState: ContainerState | undefined;
  expectedFingerprint: string | undefined;
}): boolean {
  return (
    (input.currentState
      ? createContainerStateFingerprint(input.currentState)
      : undefined) === input.expectedFingerprint
  );
}
