import type {
  ContainerContentsStore,
  ContainerNode,
} from "@symcrypt/client-sdk";
import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
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
// own rules/link bookkeeping around it. Returns null (a no-op) when no Trash is
// resolvable/creatable, or when the document already lives under Trash.
export async function resolveDeleteToTrashTarget(
  input: ResolveDeleteToTrashTargetInput,
): Promise<string | null> {
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

  if (
    !trashContainerId ||
    isExplorerContainerUnderTrash(nodes, containerId, trashContainerId)
  ) {
    return null;
  }

  return trashContainerId;
}
