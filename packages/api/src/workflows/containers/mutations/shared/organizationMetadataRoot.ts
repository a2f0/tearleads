import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import type { ContainerAccessManifestState } from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq } from "drizzle-orm";
import { ContainerMutationError } from "../errors";

/** The reserved metadata root never inherits grants or accepts extra recipients. */
export async function assertOrganizationMetadataRoot(
  executor: DatabaseTransaction,
  state: ContainerAccessManifestState,
): Promise<void> {
  if (
    state.systemSlot !==
    (await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: state.organizationId,
    }))
  )
    return;
  const [organization] = await executor
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, state.organizationId))
    .limit(1);
  if (
    !organization ||
    state.parentContainerId !== null ||
    state.directGrants.length !== 2 ||
    !state.directGrants.some(
      (grant) =>
        grant.subjectType === "group" &&
        grant.subjectId === organization.adminGroupId &&
        grant.accessLevel === "admin",
    ) ||
    !state.directGrants.some(
      (grant) =>
        grant.subjectType === "group" &&
        grant.subjectId === organization.memberGroupId &&
        grant.accessLevel === "read",
    )
  ) {
    throw new ContainerMutationError(
      "Organization metadata requires only reserved Admins and Members grants on an independent root",
      403,
    );
  }
}
