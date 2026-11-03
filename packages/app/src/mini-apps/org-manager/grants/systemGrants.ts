import type { OrganizationContainerGrant } from "@tearleads/client-sdk";

/**
 * The organization metadata system grants are the built-in Members and Admins
 * grants on the organization metadata container. The API marks three grants
 * built-in (Admins on the root container, and Admins and Members on the
 * metadata container), and only the metadata container carries a built-in
 * Members grant, so that grant is what identifies it; the built-in Admins
 * grant on the root container is never matched.
 *
 * Without the Members group id, or when the grants hold no built-in Members
 * grant, the metadata container cannot be told apart from the root container
 * and nothing is matched, rather than risk hiding the root Admins grant.
 */
function organizationMetadataContainerIds(
  grants: ReadonlyArray<OrganizationContainerGrant>,
  memberGroupId: string | null,
): ReadonlySet<string> {
  if (!memberGroupId) {
    return new Set();
  }

  return new Set(
    grants
      .filter(
        (grant) =>
          grant.isBuiltin &&
          grant.subjectType === "group" &&
          grant.subjectId === memberGroupId,
      )
      .map((grant) => grant.containerId),
  );
}

/**
 * Removes the organization metadata system grants from every list. The
 * metadata container is identified across all the lists together, so a
 * section without the Members grant (a user's direct grants beside their group
 * grants) still loses its metadata grants.
 */
export function withoutOrganizationMetadataSystemGrants(
  grantLists: ReadonlyArray<ReadonlyArray<OrganizationContainerGrant>>,
  memberGroupId: string | null,
): ReadonlyArray<ReadonlyArray<OrganizationContainerGrant>> {
  const metadataContainerIds = organizationMetadataContainerIds(
    grantLists.flat(),
    memberGroupId,
  );
  if (metadataContainerIds.size === 0) {
    return grantLists;
  }

  return grantLists.map((grants) =>
    grants.filter(
      (grant) =>
        !(grant.isBuiltin && metadataContainerIds.has(grant.containerId)),
    ),
  );
}
