import type { ContainerNode } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useMemo } from "react";
import {
  canProvisionExplorerSystemContainers,
  findContactsSystemContainerSlot,
  findTrashSystemContainerSlot,
  getExplorerVisibleSystemSlots,
  useExplorerSystemContainerSlots,
} from "./ExplorerSystemContainers";

interface ExplorerSystemProvisioning {
  contactsSystemSlot: ContainerSystemSlot | null;
  shouldProvisionSystemContainers: boolean;
  trashSystemSlot: ContainerSystemSlot | null;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

/**
 * Derive the explorer's system-container slots for visibility and rules.
 * Actual system container creation is owned by the runtime-level system
 * bootstrapper so mini-apps do not race each other.
 */
export function useExplorerSystemProvisioning(input: {
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

  return {
    contactsSystemSlot,
    shouldProvisionSystemContainers,
    trashSystemSlot,
    visibleSystemSlots,
  };
}
