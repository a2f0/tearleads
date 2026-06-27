import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useMemo } from "react";
import {
  findContactsSystemContainerSlot,
  findTrashSystemContainerSlot,
  getExplorerVisibleSystemSlots,
  useExplorerSystemContainerSlots,
} from "./ExplorerSystemContainers";

interface ExplorerSystemProvisioning {
  contactsSystemSlot: ContainerSystemSlot | null;
  trashSystemSlot: ContainerSystemSlot | null;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

/**
 * Derive the explorer's system-container slots for visibility and rules.
 * Actual system container creation is owned by the runtime-level system
 * bootstrapper so mini-apps do not race each other.
 */
export function useExplorerSystemProvisioning(input: {
  signingPrivateKey: Uint8Array | null;
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

  return {
    contactsSystemSlot,
    trashSystemSlot,
    visibleSystemSlots,
  };
}
