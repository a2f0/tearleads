import type { ContainerNode } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useState } from "react";
import { getExplorerSystemContainerId } from "../explorer/ExplorerSystemContainers";
import {
  deriveUserSystemContainers,
  findUserSystemContainer,
} from "../systemContainers";

type ContactsContainerLookupNode = Pick<
  ContainerNode,
  "id" | "organizationId" | "parentId" | "systemSlot"
>;

// The Contacts container projection resolves the same way as any other system
// container, so delegate to the shared Explorer resolver rather than duplicating
// it. Trash resolution now lives in stores/systemContainerTrash.
export function getContactsContainerId(
  nodes: ReadonlyArray<ContactsContainerLookupNode> | null,
  contactsSystemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): string | null {
  return getExplorerSystemContainerId(
    nodes,
    contactsSystemSlot,
    organizationId,
    rootContainerId,
  );
}

export function useContactsSystemSlots(input: {
  logError: (message: string | Error, cause?: unknown) => void;
  signingPrivateKey: Uint8Array | null;
}): {
  contactsSystemSlot: ContainerSystemSlot | null;
  trashSystemSlot: ContainerSystemSlot | null;
} {
  const [systemSlots, setSystemSlots] = useState<{
    contactsSystemSlot: ContainerSystemSlot | null;
    trashSystemSlot: ContainerSystemSlot | null;
  }>({ contactsSystemSlot: null, trashSystemSlot: null });

  useEffect(() => {
    if (!input.signingPrivateKey) {
      setSystemSlots({ contactsSystemSlot: null, trashSystemSlot: null });
      return;
    }

    const signingPrivateKey = input.signingPrivateKey;
    let cancelled = false;
    void deriveUserSystemContainers(signingPrivateKey)
      .then((systemContainers) => {
        if (cancelled) {
          return;
        }

        setSystemSlots({
          contactsSystemSlot:
            findUserSystemContainer(systemContainers, "contacts")?.systemSlot ??
            null,
          trashSystemSlot:
            findUserSystemContainer(systemContainers, "trash")?.systemSlot ??
            null,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setSystemSlots({ contactsSystemSlot: null, trashSystemSlot: null });
          input.logError("Failed to derive contacts system slots", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.logError, input.signingPrivateKey]);

  return systemSlots;
}
