import type { ContainerNode } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useState } from "react";
import {
  deriveUserSystemContainers,
  findUserSystemContainer,
} from "../systemContainers";

type ContactsContainerLookupNode = Pick<
  ContainerNode,
  "id" | "organizationId" | "parentId" | "systemSlot"
>;

function getSystemContainerId(
  nodes: ReadonlyArray<ContactsContainerLookupNode> | null,
  systemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): string | null {
  if (!systemSlot) {
    return null;
  }

  let fallback: ContactsContainerLookupNode | null = null;
  for (const node of nodes ?? []) {
    if (node.systemSlot !== systemSlot) {
      continue;
    }
    if (rootContainerId != null && node.parentId === rootContainerId) {
      return node.id;
    }
    if (
      rootContainerId != null
        ? organizationId != null && node.organizationId === organizationId
        : organizationId == null || node.organizationId === organizationId
    ) {
      fallback ??= node;
    }
  }

  return fallback?.id ?? null;
}

export function getContactsContainerId(
  nodes: ReadonlyArray<ContactsContainerLookupNode> | null,
  contactsSystemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): string | null {
  return getSystemContainerId(
    nodes,
    contactsSystemSlot,
    organizationId,
    rootContainerId,
  );
}

export function getContactsTrashContainerId(
  nodes: ReadonlyArray<ContactsContainerLookupNode> | null,
  trashSystemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): string | null {
  return getSystemContainerId(
    nodes,
    trashSystemSlot,
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
