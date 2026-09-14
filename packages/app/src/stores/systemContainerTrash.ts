import type {
  ContainerContentsStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  isExplorerContainerUnderTrash,
  resolveExplorerDeleteTrashTarget,
} from "./explorer/ExplorerSystemContainers";
import {
  EXPLORER_TRASH_CONTAINER_ICON,
  EXPLORER_TRASH_CONTAINER_NAME,
} from "./systemContainers";

// deferRemoteBootstrap creates the Trash locally so a not-yet-synced /
// payment-lapsed org still gets one; adding deferRemoteSync would suppress the
// create-intent and permanently strand the queued document move-intent replay.
const TRASH_ENSURE_OPTIONS = {
  deferRemoteBootstrap: true,
  icon: EXPLORER_TRASH_CONTAINER_ICON,
} as const;

// Lazily provision the viewer's own Trash system container. Shared by Explorer,
// Contacts, and the Notes trash hook so all three provision Trash identically.
// A null slot (not yet derived) resolves to null rather than throwing.
export function ensureTrashSystemContainer(
  store: ContainerContentsStore,
  trashSystemSlot: ContainerSystemSlot | null,
): Promise<ContainerNode | null> {
  if (!trashSystemSlot) {
    return Promise.resolve(null);
  }

  return store.ensureSystemContainer(
    trashSystemSlot,
    EXPLORER_TRASH_CONTAINER_NAME,
    TRASH_ENSURE_OPTIONS,
  );
}

// Why no Trash could be resolved. "awaiting-sync" is the viewer's own org before
// its verified root (and so its Trash) has arrived on this device; a fresh
// device sees it until the first hydration pass completes. "foreign-trash-
// unverified" is a shared org created by another identity, whose Trash slot the
// viewer cannot derive, so no destination can be verified.
export type DeleteToTrashUnavailableReason =
  | "awaiting-sync"
  | "foreign-trash-unverified";

const DELETE_TO_TRASH_UNAVAILABLE_MESSAGES: Readonly<
  Record<DeleteToTrashUnavailableReason, string>
> = {
  "awaiting-sync": "Trash is unavailable until sync completes.",
  "foreign-trash-unverified":
    "This organization's Trash cannot be verified from this device.",
};

export type DeleteToTrashTarget =
  | { readonly status: "target"; readonly trashContainerId: string }
  | { readonly status: "already-in-trash" }
  | {
      readonly status: "unavailable";
      readonly reason: DeleteToTrashUnavailableReason;
    };

// Typed failure for callers that surface the outcome as an error (the Notes
// move-to-trash hook); the message is user-facing.
export class TrashUnavailableError extends Error {
  constructor(readonly reason: DeleteToTrashUnavailableReason) {
    super(DELETE_TO_TRASH_UNAVAILABLE_MESSAGES[reason]);
    this.name = "TrashUnavailableError";
  }
}

interface ResolveDeleteToTrashTargetInput {
  containerId: string | null;
  currentOrganizationId: string | null | undefined;
  nodes: ReadonlyArray<ContainerNode> | null | undefined;
  trashSystemSlot: ContainerSystemSlot | null;
  // Lazily create the viewer's OWN Trash when none is resolved. Only invoked for
  // the viewer's own organization (canFallBackToOwnTrash) — a foreign org's Trash
  // is never substituted with the viewer's, so an absent one aborts the delete.
  ensureOwnTrashContainer: () => Promise<{ id: string } | null>;
}

// Resolve the Trash a document living in `containerId` should be moved into,
// org-awarely, and lazily provisioning the viewer's own Trash when needed. This
// is the shared core of the delete-to-trash sequence used by Explorer, Notes, and
// Contacts: it deliberately does NOT perform the move, so each caller keeps its
// own rules/link bookkeeping around it. A non-target outcome says why, so the
// caller can tell the user instead of silently doing nothing.
export async function resolveDeleteToTrashTarget(
  input: ResolveDeleteToTrashTargetInput,
): Promise<DeleteToTrashTarget> {
  const {
    containerId,
    currentOrganizationId,
    ensureOwnTrashContainer,
    nodes,
    trashSystemSlot,
  } = input;

  const trashResolution = resolveExplorerDeleteTrashTarget({
    containerId,
    currentOrganizationId,
    nodes,
    trashSystemSlot,
  });
  const trashContainerId =
    trashResolution.trashContainerId ??
    (trashResolution.canFallBackToOwnTrash
      ? (await ensureOwnTrashContainer())?.id
      : undefined);

  if (!trashContainerId) {
    return {
      status: "unavailable",
      reason: trashResolution.canFallBackToOwnTrash
        ? "awaiting-sync"
        : "foreign-trash-unverified",
    };
  }
  if (isExplorerContainerUnderTrash(nodes, containerId, trashContainerId)) {
    return { status: "already-in-trash" };
  }

  return { status: "target", trashContainerId };
}
