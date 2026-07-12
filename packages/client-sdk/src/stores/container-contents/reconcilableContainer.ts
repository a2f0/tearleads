import type { ContainerNode } from "./types";

/**
 * Whether a container is a system container — one tagged with a deterministic
 * `systemSlot` for a built-in role such as Contacts, Trash, organization
 * metadata, or the per-organization roster.
 */
export function isSystemContainerNode(
  node: Pick<ContainerNode, "systemSlot">,
): boolean {
  return !!node.systemSlot;
}

/** Whether a container has completed enough remote creation to be listed. */
export function isRemoteBackedContainerNode(
  node: Pick<ContainerNode, "metadataDocumentId">,
): boolean {
  return (
    typeof node.metadataDocumentId === "string" &&
    node.metadataDocumentId.length > 0
  );
}

/**
 * Whether generic document reconciliation may safely list this container.
 *
 * User containers retain their existing device-first behavior. System
 * containers join generic reconciliation only after remote creation has given
 * them a metadata document id; this lets another device rematerialize Contacts,
 * Trash, and other system data without racing a just-created local slot's first
 * server round-trip.
 */
export function isReconcilableContainerNode(
  node: Pick<
    ContainerNode,
    | "effectiveAccessLevel"
    | "metadataDocumentId"
    | "organizationId"
    | "systemSlot"
  >,
  homeOrganizationId: string | null,
): boolean {
  if (!isSystemContainerNode(node)) {
    return true;
  }

  return (
    isRemoteBackedContainerNode(node) &&
    homeOrganizationId !== null &&
    (node.organizationId === homeOrganizationId ||
      isForeignSystemContainerNode(node, homeOrganizationId))
  );
}

/**
 * Whether a root-lane discovery hint should re-list this container's documents.
 *
 * The server's root discovery lane can return directly granted non-root
 * containers, so every regular container remains eligible regardless of its
 * parent. Membership-visible foreign system containers remain eligible for
 * catch-up. Own system children are excluded here because
 * cold/auth backfill and explicit full refresh already reconcile them; sweeping
 * them on every Explorer-open or shared-root hint creates redundant work.
 */
export function isAutomaticRootCatchupContainerNode(
  node: Pick<
    ContainerNode,
    "effectiveAccessLevel" | "organizationId" | "systemSlot"
  >,
  homeOrganizationId: string | null,
): boolean {
  return (
    !isSystemContainerNode(node) ||
    isForeignSystemContainerNode(node, homeOrganizationId)
  );
}

/**
 * Whether a system container belongs to a foreign organization whose contents
 * are visible through membership-level access.
 *
 * Event routing uses this classification for foreign system content whose
 * already-known document updates must still force discovery. It is not the
 * generic sweep predicate: remote-backed own system containers also reconcile
 * via {@link isReconcilableContainerNode}. A foreign system container is one
 * that is:
 *
 *  - a different org's (`organizationId !== homeOrganizationId`). Own system
 *    containers are outside this foreign-system classification, while a
 *    container mid-creation has an empty organization id that matches nothing
 *    (as does a null/unhydrated home org).
 *  - granted at a *membership* level — `read` (Members group) or `admin`
 *    (Admins group). A plain `write` share of a folder does not make the sharee
 *    a member, so it does not opt that folder into automatic root catch-up.
 */
export function isForeignSystemContainerNode(
  node: Pick<
    ContainerNode,
    "systemSlot" | "organizationId" | "effectiveAccessLevel"
  >,
  homeOrganizationId: string | null,
): boolean {
  return (
    isSystemContainerNode(node) &&
    homeOrganizationId !== null &&
    !!node.organizationId &&
    node.organizationId !== homeOrganizationId &&
    (node.effectiveAccessLevel === "read" ||
      node.effectiveAccessLevel === "admin")
  );
}
