import {
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useMemo, useState } from "react";
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

const EMPTY_SYSTEM_SLOTS: ReadonlyArray<ContainerSystemSlot> = [];

function useBuiltInSystemContainerSlots(input: {
  enabled: boolean;
  logError: (message: string | Error, cause?: unknown) => void;
  organizationId: string | null;
}): ReadonlyArray<ContainerSystemSlot> {
  const [systemSlots, setSystemSlots] =
    useState<ReadonlyArray<ContainerSystemSlot>>(EMPTY_SYSTEM_SLOTS);

  useEffect(() => {
    if (!input.enabled || !input.organizationId) {
      setSystemSlots(EMPTY_SYSTEM_SLOTS);
      return;
    }

    let cancelled = false;
    const organizationId = input.organizationId;
    void Promise.all([
      deriveOrganizationRosterProfileContainerSystemSlot({ organizationId }),
      deriveOrganizationMetadataContainerSystemSlot({ organizationId }),
    ])
      .then((nextSystemSlots) => {
        if (!cancelled) {
          setSystemSlots(nextSystemSlots);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSystemSlots(EMPTY_SYSTEM_SLOTS);
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

  return systemSlots;
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
  const builtInSystemContainerSlots = useBuiltInSystemContainerSlots({
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
        builtInSystemContainerSlots,
      ),
    [builtInSystemContainerSlots, systemContainers],
  );

  return {
    contactsSystemSlot,
    trashSystemSlot,
    visibleSystemSlots,
  };
}
