import type {
  ContainerContentsStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useMemo } from "react";
import {
  canProvisionExplorerSystemContainers,
  findContactsSystemContainerSlot,
  findTrashSystemContainerSlot,
  getExplorerOwnedSystemContainers,
  getExplorerVisibleSystemSlots,
  useEnsureExplorerSystemContainers,
  useExplorerSystemContainerSlots,
} from "./ExplorerSystemContainers";

interface ExplorerSystemProvisioning {
  contactsSystemSlot: ContainerSystemSlot | null;
  shouldProvisionSystemContainers: boolean;
  trashSystemSlot: ContainerSystemSlot | null;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

/**
 * Derive the explorer's system-container slots and run the provisioning
 * effects (trash/contacts) for the current container tree. Extracted from the
 * provider so its body stays focused on wiring the device-first view.
 */
export function useExplorerSystemProvisioning(input: {
  store: ContainerContentsStore;
  ready: boolean;
  nodes: ReadonlyArray<ContainerNode>;
  signingPrivateKey: Uint8Array | null;
  organizationId: string | null;
  rootContainerId: string | null;
  isAuthenticated: boolean;
  logError: (message: string | Error, cause?: unknown) => void;
}): ExplorerSystemProvisioning {
  const systemContainers = useExplorerSystemContainerSlots({
    logError: input.logError,
    signingPrivateKey: input.signingPrivateKey,
  });
  const trashSystemSlot = findTrashSystemContainerSlot(systemContainers);
  const contactsSystemSlot = findContactsSystemContainerSlot(systemContainers);
  const visibleSystemSlots = useMemo(
    () => getExplorerVisibleSystemSlots(systemContainers),
    [systemContainers],
  );
  const explorerSystemContainers = useMemo(
    () => getExplorerOwnedSystemContainers(systemContainers),
    [systemContainers],
  );
  const shouldProvisionSystemContainers = useMemo(
    () =>
      canProvisionExplorerSystemContainers({
        isAuthenticated: input.isAuthenticated,
        nodes: input.nodes,
        organizationId: input.organizationId,
        rootContainerId: input.rootContainerId,
      }),
    [
      input.isAuthenticated,
      input.organizationId,
      input.rootContainerId,
      input.nodes,
    ],
  );

  useEnsureExplorerSystemContainers({
    containerContentsReady: input.ready,
    containerContentsStore: input.store,
    logError: input.logError,
    nodes: input.nodes,
    shouldProvisionSystemContainers,
    systemContainers: explorerSystemContainers,
  });

  return {
    contactsSystemSlot,
    shouldProvisionSystemContainers,
    trashSystemSlot,
    visibleSystemSlots,
  };
}
