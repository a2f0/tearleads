import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import type { ContainerAccessManifestState } from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq } from "drizzle-orm";
import { ContainerMutationError } from "../errors";

/** The organization facts that decide every built-in container grant. */
export interface OrganizationBuiltinGrantSubjects {
  readonly adminGroupId: string;
  readonly memberGroupId: string;
  readonly rootContainerId: string;
}

export async function loadOrganizationBuiltinGrantSubjects(
  executor: DatabaseTransaction,
  organizationId: string,
): Promise<OrganizationBuiltinGrantSubjects | null> {
  const [organization] = await executor
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
      rootContainerId: organizations.rootContainerId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return organization ?? null;
}

export async function isOrganizationMetadataRootState(
  state: ContainerAccessManifestState,
): Promise<boolean> {
  return (
    state.systemSlot ===
    (await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: state.organizationId,
    }))
  );
}

/** The reserved metadata root never inherits grants or accepts extra recipients. */
export function assertOrganizationMetadataRoot(
  organization: OrganizationBuiltinGrantSubjects | null,
  state: ContainerAccessManifestState,
): void {
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
