import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { errorMessage } from "../../data/errorMessage";
import { reportAndRethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { isDatabaseUnavailableError } from "../../workflows/container-contents/syncLane";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

// Best-effort remote probe for an already-existing system container. System
// containers occupy root lanes, so this probes those lanes (not a
// full-tree refresh). Device-first: a network failure must not abort
// provisioning, or a caller that waits on this container never observes it.
export async function probeExistingSystemContainer(input: {
  readonly logLabel: string;
  readonly rootState: ContainerState | null;
  readonly state: ContainerContentsStoreState;
  readonly syncAgent: ContainerContentsStoreSyncAgent;
  readonly systemSlot: ContainerSystemSlot;
  readonly independentRoot?: boolean;
}): Promise<void> {
  try {
    await input.syncAgent.requestRemoteHydration({
      ...(input.independentRoot ? { followDiscoveredParentLanes: false } : {}),
      parentIds:
        input.rootState && !input.independentRoot
          ? [null, input.rootState.container.id]
          : [null],
    });
  } catch (error) {
    await reportAndRethrowKeyingVerificationError(
      error,
      input.state.runtime.util.reportSecurityIncident,
      {
        objectId: input.rootState?.container.id ?? null,
        objectKind: "container",
        operation: "container.system.hydrate",
        organizationId: input.rootState?.container.organizationId,
      },
    );
    if (!isDatabaseUnavailableError(error)) {
      const reason = errorMessage(error);
      input.state.runtime.util.log(
        `${input.logLabel}: remote probe for "${input.systemSlot}" failed (${reason})`,
      );
    }
  }
}
