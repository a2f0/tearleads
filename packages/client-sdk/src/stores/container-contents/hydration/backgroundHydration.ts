import { errorMessage } from "../../../data/shared/errorMessage";
import { reportKeyingVerificationErrorInCauseChain } from "../../../data/shared/securityIncidents";
import { isDatabaseUnavailableError } from "../../../workflows/container-contents/syncLane";
import type { ContainerContentsStoreSyncState } from "../syncAgent/syncAgentTypes";

/** Observe a background refresh without changing the caller's rejection. */
export function observeContainerBackgroundHydration(
  state: ContainerContentsStoreSyncState,
  hydration: Promise<unknown>,
): void {
  state.trackBackgroundHydration?.(hydration);
  const generation = state.lifecycleGeneration;
  const runtime = state.runtime;
  void hydration.catch(async (error: unknown) => {
    if (
      state.syncLane?.isDisposed?.() ||
      state.lifecycleGeneration !== generation ||
      isDatabaseUnavailableError(error)
    )
      return;

    await reportKeyingVerificationErrorInCauseChain(
      error,
      runtime.util.reportSecurityIncident,
      {
        objectId: null,
        objectKind: "container",
        operation: "container.hydration.background",
        organizationId: runtime.auth.organizationId,
      },
    );
    try {
      const message = "Container background hydration failed";
      if (runtime.util.logError) {
        await runtime.util.logError(message, error);
      } else {
        await runtime.util.log(`${message}: ${errorMessage(error)}`);
      }
    } catch {
      // A host logger must not turn an observed refusal into a new rejection.
    }
  });
}
