import {
  type ContainerSystemSlot,
  deriveOrganizationMetadataContainerSystemSlot,
} from "@tearleads/validators/containerSystemSlot";
import { updateExistingSystemContainer } from "./existingSystemContainer";
import { getContainerContentsStoreLogLabel } from "./logLabel";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import { probeExistingSystemContainer } from "./systemContainerHydration";
import { findOrganizationSystemRootState } from "./systemContainerLookup";
import type {
  ContainerContentsStoreState,
  EnsureSystemContainerOptions,
} from "./types";
import type { ContainerWriteGuard } from "./writeGeneration";

/** Metadata is provisioned with reserved grants; generic ensure cannot create it. */
export async function ensureOrganizationMetadataSystemContainer(input: {
  readonly state: ContainerContentsStoreState;
  readonly syncAgent: ContainerContentsStoreSyncAgent;
  readonly systemSlot: ContainerSystemSlot;
  readonly options: EnsureSystemContainerOptions;
  readonly isCurrent: ContainerWriteGuard;
}) {
  const { state, syncAgent, systemSlot, options } = input;
  const organizationId = state.runtime.auth.organizationId;
  if (!organizationId) return { handled: false } as const;
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId,
  });
  const isCurrent = () =>
    input.isCurrent() && state.runtime.auth.organizationId === organizationId;
  if (!isCurrent()) return { handled: true, container: null } as const;
  if (systemSlot !== metadataSlot) return { handled: false } as const;

  let existing = findOrganizationSystemRootState(
    state,
    organizationId,
    systemSlot,
  );
  if (
    !existing &&
    !options.deferRemoteBootstrap &&
    state.runtime.auth.isAuthenticated &&
    state.runtime.state.online
  ) {
    await probeExistingSystemContainer({
      logLabel: getContainerContentsStoreLogLabel(state),
      rootState: null,
      state,
      syncAgent,
      systemSlot,
      independentRoot: true,
    });
    if (!isCurrent()) return { handled: true, container: null } as const;
    existing = findOrganizationSystemRootState(
      state,
      organizationId,
      systemSlot,
    );
  }
  return {
    handled: true,
    container: existing
      ? await updateExistingSystemContainer(
          state,
          syncAgent,
          existing,
          options,
          isCurrent,
        )
      : null,
  } as const;
}
