import {
  type ContainerNode,
  deriveContainerSystemSlot,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useState } from "react";
import { CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION } from "../systemContainers";

type ContactsContainerLookupNode = Pick<
  ContainerNode,
  "id" | "organizationId" | "parentId" | "systemSlot"
>;

export function getContactsContainerId(
  nodes: ReadonlyArray<ContactsContainerLookupNode> | null,
  contactsSystemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): string | null {
  if (!contactsSystemSlot) {
    return null;
  }

  let fallback: ContactsContainerLookupNode | null = null;
  for (const node of nodes ?? []) {
    if (node.systemSlot !== contactsSystemSlot) {
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

export function useContactsSystemSlot(input: {
  logError: (message: string | Error, cause?: unknown) => void;
  signingPrivateKey: Uint8Array | null;
}): ContainerSystemSlot | null {
  const [contactsSystemSlot, setContactsSystemSlot] =
    useState<ContainerSystemSlot | null>(null);

  useEffect(() => {
    if (!input.signingPrivateKey) {
      setContactsSystemSlot(null);
      return;
    }

    let cancelled = false;
    void deriveContainerSystemSlot({
      definition: CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION,
      secretKey: input.signingPrivateKey,
    })
      .then((systemSlot) => {
        if (!cancelled) {
          setContactsSystemSlot(systemSlot);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setContactsSystemSlot(null);
          input.logError("Failed to derive contacts system slot", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.logError, input.signingPrivateKey]);

  return contactsSystemSlot;
}
