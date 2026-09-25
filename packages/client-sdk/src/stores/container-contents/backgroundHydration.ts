import { errorMessage } from "../../data/errorMessage";
import { reportKeyingVerificationErrorInCauseChain } from "../../data/keyingProjectionVerification/error";
import { isDatabaseUnavailableError } from "../../workflows/container-contents/syncLane";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

/** Observe a background refresh without changing the caller's rejection. */
export function observeContainerBackgroundHydration(
  state: ContainerContentsStoreSyncState,
  hydration: Promise<void>,
): void {
  const generation = state.lifecycleGeneration;
  const runtime = state.runtime;
  void hydration.catch(async (error: unknown) => {
    if (
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
