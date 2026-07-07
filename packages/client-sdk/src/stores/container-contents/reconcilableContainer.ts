import type { ContainerNode } from "./types";

/**
 * Whether a container is a system container — one tagged with a deterministic
 * `systemSlot` (the per-org roster and organization-metadata containers), as
 * opposed to a user-facing container.
 */
export function isSystemContainerNode(
  node: Pick<ContainerNode, "systemSlot">,
): boolean {
  return !!node.systemSlot;
}

/**
 * Whether a system container is a *foreign* org's metadata container that this
 * device is a member of — one whose profile document (holding that org's display
 * name) the device must pull because it did not author it.
 *
 * The reconciler uses this to decide which system containers to sweep and which
 * discovered documents to pull eagerly, so it is deliberately narrow. A foreign
 * metadata container is one that is:
 *
 *  - a different org's (`organizationId !== homeOrganizationId`). Own system
 *    containers are excluded — this device authors their contents (the org
 *    profile, roster) and dedicated agents push them, so there is nothing to
 *    pull, and sweeping a just-created one races the server round-trip and 404s.
 *    A container mid-creation has an empty organization id that resolves only
 *    after the round-trip; it is this device's own, so an empty id matches
 *    nothing (as does a null/unhydrated home org).
 *  - granted at a *membership* level — `read` (Members group) or `admin`
 *    (Admins group). A plain `write` share of a folder does not make the sharee
 *    a member and must not leak the org name, and roster containers (the only
 *    other system container) are never shared across orgs at all. So a foreign
 *    system container held at read/admin is always the metadata container.
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
