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

export function resolveContactsProjectionOrganizationId(input: {
  contactsSystemSlot: ContainerSystemSlot | null;
  defaultOrganizationId: string | null | undefined;
  legacyPrimaryOrganizationId: string | null | undefined;
  nodes: ReadonlyArray<ContactsContainerLookupNode> | null;
}): string | null {
  if (input.defaultOrganizationId) {
    return input.defaultOrganizationId;
  }

  const projectedOrganizationIds = new Set(
    input.contactsSystemSlot
      ? (input.nodes ?? [])
          .filter((node) => node.systemSlot === input.contactsSystemSlot)
          .map((node) => node.organizationId)
      : [],
  );
  if (
    input.legacyPrimaryOrganizationId &&
    projectedOrganizationIds.has(input.legacyPrimaryOrganizationId)
  ) {
    return input.legacyPrimaryOrganizationId;
  }
  if (projectedOrganizationIds.size === 1) {
    return projectedOrganizationIds.values().next().value ?? null;
  }

  // A legacy session has no authoritative default-org id. One projected org is
  // unambiguous; when stale same-slot Contacts containers collide, prefer the
  // legacy primary instead of whichever node happens to be listed first.
  return input.legacyPrimaryOrganizationId || null;
}

export function resolveContactsProjectionRootContainerId(input: {
  activeOrganizationId: string | null | undefined;
  activeRootContainerId: string | null | undefined;
  nodes: ReadonlyArray<ContactsContainerLookupNode>;
  projectionOrganizationId: string | null | undefined;
}): string | null {
  const projectedRoot = input.nodes.find(
    (node) =>
      node.parentId === null &&
      node.organizationId === input.projectionOrganizationId,
  );
  if (projectedRoot) {
    return projectedRoot.id;
  }

  return input.projectionOrganizationId &&
    input.activeOrganizationId === input.projectionOrganizationId
    ? (input.activeRootContainerId ?? null)
    : null;
}

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
