import type {
  ContainerContentsStore,
  ContainerNode,
} from "@tearleads/client-sdk";
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
  readonly isAuthenticated: boolean;
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
    // The slot already exists. If it was created device-first (local-only) and
    // we are now authenticated, promote it into remote sync so every system
    // container (Trash included, not just Contacts) reaches the server without
    // requiring the user to open it. ensureSystemContainer without
    // deferRemoteSync routes the existing slot through
    // promoteExistingLocalSystemContainerSync; the call is idempotent once the
    // container has a remote create intent, so a non-local-only slot is a no-op.
    if (
      !hasConfiguredIcon ||
      (input.isAuthenticated && existing.syncState.status === "local-only")
    ) {
      return input.store.ensureSystemContainer(
        input.systemContainer.systemSlot,
        input.systemContainer.name,
        {
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
