import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useMemo, useState } from "react";
import {
  type BuiltInSystemContainer,
  deriveBuiltInSystemContainers,
} from "../systemContainers";
import {
  findContactsSystemContainerSlot,
  findTrashSystemContainerSlot,
  getExplorerVisibleSystemSlots,
  useExplorerSystemContainerSlots,
} from "./ExplorerSystemContainers";

interface ExplorerSystemProvisioning {
  builtInSystemContainers: ReadonlyArray<BuiltInSystemContainer>;
  contactsSystemSlot: ContainerSystemSlot | null;
  trashSystemSlot: ContainerSystemSlot | null;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

const EMPTY_BUILT_IN_SYSTEM_CONTAINERS: ReadonlyArray<BuiltInSystemContainer> =
  [];

function useBuiltInSystemContainers(input: {
  enabled: boolean;
  logError: (message: string | Error, cause?: unknown) => void;
  organizationId: string | null;
}): ReadonlyArray<BuiltInSystemContainer> {
  const [builtInSystemContainers, setBuiltInSystemContainers] = useState<
    ReadonlyArray<BuiltInSystemContainer>
  >(EMPTY_BUILT_IN_SYSTEM_CONTAINERS);

  useEffect(() => {
    if (!input.enabled || !input.organizationId) {
      setBuiltInSystemContainers(EMPTY_BUILT_IN_SYSTEM_CONTAINERS);
      return;
    }

    let cancelled = false;
    const organizationId = input.organizationId;
    void deriveBuiltInSystemContainers({ organizationId })
      .then((nextBuiltInSystemContainers) => {
        if (!cancelled) {
          setBuiltInSystemContainers(nextBuiltInSystemContainers);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBuiltInSystemContainers(EMPTY_BUILT_IN_SYSTEM_CONTAINERS);
          input.logError(
            "Failed to derive built-in explorer system slots",
            error,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.logError, input.organizationId]);

  return builtInSystemContainers;
}

/**
 * Derive the explorer's system-container slots for visibility and rules.
 * Actual system container creation is owned by the runtime-level system
 * bootstrapper so mini-apps do not race each other.
 */
export function useExplorerSystemProvisioning(input: {
  organizationId: string | null;
  signingPrivateKey: Uint8Array | null;
  showBuiltInSystemContainers: boolean;
  logError: (message: string | Error, cause?: unknown) => void;
}): ExplorerSystemProvisioning {
  const systemContainers = useExplorerSystemContainerSlots({
    logError: input.logError,
    signingPrivateKey: input.signingPrivateKey,
  });
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
