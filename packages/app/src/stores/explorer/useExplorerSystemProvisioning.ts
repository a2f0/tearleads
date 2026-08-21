import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { useMemo } from "react";
import { useUserSystemContainers } from "../../providers/system-bootstrap/UserSystemContainersProvider";
import { useAsyncDerivedState } from "../../utils/useAsyncDerivedState";
import {
  type BuiltInSystemContainer,
  deriveBuiltInSystemContainers,
} from "../systemContainers";
import {
  findContactsSystemContainerSlot,
  findTrashSystemContainerSlot,
  getExplorerVisibleSystemSlots,
} from "./ExplorerSystemContainers";

interface ExplorerSystemProvisioning {
  builtInSystemContainers: ReadonlyArray<BuiltInSystemContainer>;
  contactsSystemSlot: ContainerSystemSlot | null;
  trashSystemSlot: ContainerSystemSlot | null;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

const EMPTY_BUILT_IN_SYSTEM_CONTAINERS: ReadonlyArray<BuiltInSystemContainer> =
  [];

const getEmptyBuiltInSystemContainers = () => EMPTY_BUILT_IN_SYSTEM_CONTAINERS;

const deriveOrganizationBuiltInSystemContainers = (organizationId: string) =>
  deriveBuiltInSystemContainers({ organizationId });

function useBuiltInSystemContainers(input: {
  enabled: boolean;
  logError: (message: string | Error, cause?: unknown) => void;
  organizationId: string | null;
}): ReadonlyArray<BuiltInSystemContainer> {
  return useAsyncDerivedState({
    createEmptyValue: getEmptyBuiltInSystemContainers,
    derive: deriveOrganizationBuiltInSystemContainers,
    errorMessage: "Failed to derive built-in explorer system slots",
    logError: input.logError,
    source: input.enabled ? input.organizationId : null,
  });
}

/**
 * Derive the explorer's system-container slots for visibility and rules.
 * Actual system container creation is owned by the runtime-level system
 * bootstrapper so mini-apps do not race each other.
 */
export function useExplorerSystemProvisioning(input: {
  organizationId: string | null;
  showBuiltInSystemContainers: boolean;
  logError: (message: string | Error, cause?: unknown) => void;
}): ExplorerSystemProvisioning {
  const systemContainers = useUserSystemContainers();
  const builtInSystemContainers = useBuiltInSystemContainers({
    enabled: input.showBuiltInSystemContainers,
    logError: input.logError,
    organizationId: input.organizationId,
  });
  const trashSystemSlot = findTrashSystemContainerSlot(systemContainers);
  const contactsSystemSlot = findContactsSystemContainerSlot(systemContainers);
  const visibleSystemSlots = useMemo(
    () =>
      getExplorerVisibleSystemSlots(
        systemContainers,
        builtInSystemContainers.map(
          (builtInSystemContainer) => builtInSystemContainer.systemSlot,
        ),
      ),
    [builtInSystemContainers, systemContainers],
  );

  return {
    builtInSystemContainers,
    contactsSystemSlot,
    trashSystemSlot,
    visibleSystemSlots,
  };
}
