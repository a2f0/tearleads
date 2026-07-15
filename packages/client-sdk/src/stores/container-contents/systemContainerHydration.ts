import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { isDestroyedDatabaseClientError } from "../../workflows/container-contents/syncLane";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

// Best-effort remote probe for an already-existing system container. System
// containers only live under the root, so this probes the root lanes (not a
// full-tree refresh). Device-first: a network failure must not abort
// provisioning, or a caller that waits on this container never observes it.
export async function probeExistingSystemContainer(input: {
  readonly logLabel: string;
  readonly rootState: ContainerState | null;
  readonly state: ContainerContentsStoreState;
  readonly syncAgent: ContainerContentsStoreSyncAgent;
  readonly systemSlot: ContainerSystemSlot;
}): Promise<void> {
  try {
    await input.syncAgent.requestRemoteHydration({
      parentIds: input.rootState
        ? [null, input.rootState.container.id]
        : [null],
    });
  } catch (error) {
    rethrowKeyingVerificationError(error);
    if (!isDestroyedDatabaseClientError(error)) {
      const reason = error instanceof Error ? error.message : String(error);
      input.state.runtime.util.log(
        `${input.logLabel}: remote probe for "${input.systemSlot}" failed (${reason}); creating it locally`,
      );
    }
  }
}
