import {
  type ContainerNode,
  deriveContainerSystemSlot,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useState } from "react";
import { CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION } from "../systemContainers";

export function getContactsContainerId(
  nodes: ReadonlyArray<Pick<ContainerNode, "id" | "systemSlot">> | null,
  contactsSystemSlot: ContainerSystemSlot | null,
): string | null {
  if (!contactsSystemSlot) {
    return null;
  }

  return (
    nodes?.find((node) => node.systemSlot === contactsSystemSlot)?.id ?? null
  );
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
