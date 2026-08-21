import type {
  ContainerContentsStore,
  ContainerNode,
} from "@symcrypt/client-sdk";
import { findExplorerSystemNode } from "../../stores/explorer/ExplorerSystemContainers";
import type { UserSystemContainer } from "../../stores/systemContainers";

function findExistingSystemContainer(
  currentOrganizationId: string | null | undefined,
  currentRootContainerId: string | null | undefined,
  store: ContainerContentsStore,
  systemContainer: UserSystemContainer,
): ContainerNode | null {
  return findExplorerSystemNode(
    store.getSnapshot().nodes,
    systemContainer.systemSlot,
    currentOrganizationId,
    currentRootContainerId,
  );
}

export async function ensureSystemBootstrapContainer(input: {
  readonly currentOrganizationId: string | null | undefined;
  readonly currentRootContainerId: string | null | undefined;
  readonly store: ContainerContentsStore;
  readonly systemContainer: UserSystemContainer;
}): Promise<ContainerNode | null> {
  const existing = findExistingSystemContainer(
    input.currentOrganizationId,
    input.currentRootContainerId,
    input.store,
    input.systemContainer,
  );
  if (existing) {
    const hasConfiguredIcon =
      (existing.icon ?? null) === input.systemContainer.icon;
    // The main bootstrap pass is local-only: remote promotion is owned by
    // usePromoteLocalSystemContainers so the initial run does not both seed local
    // state and enqueue remote sync. If a local-only slot needs an icon correction,
    // keep that correction local and let the later promotion carry it up.
    if (!hasConfiguredIcon) {
      return input.store.ensureSystemContainer(
        input.systemContainer.systemSlot,
        input.systemContainer.name,
        {
          deferRemoteSync:
            existing.syncState.status === "local-only" ? true : undefined,
          icon: input.systemContainer.icon,
          skipAdvancedManagedRoot: true,
        },
      );
    }
    return existing;
  }

  return input.store.ensureSystemContainer(
    input.systemContainer.systemSlot,
    input.systemContainer.name,
    {
      deferRemoteBootstrap: true,
      deferRemoteSync: true,
      icon: input.systemContainer.icon,
      skipAdvancedManagedRoot: true,
    },
  );
}
