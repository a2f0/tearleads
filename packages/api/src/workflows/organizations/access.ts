import { eq } from "drizzle-orm";
import type { DatabaseSession } from "../../adapters/postgres";
import { organizations } from "../../schema";
import { OrganizationManagerError } from "./errors";
import { listUserReachableCurrentGroupIds } from "./principalReachability";

interface OrganizationAccess {
  isOrgAdmin: boolean;
}

export async function isUserReachableThroughCurrentGroup(input: {
  executor: DatabaseSession;
  groupId: string;
  userId: string;
}): Promise<boolean> {
  const reachableGroupIds = await listUserReachableCurrentGroupIds({
    executor: input.executor,
    groupIds: [input.groupId],
    userId: input.userId,
  });

  return reachableGroupIds.has(input.groupId);
}

async function loadOrganizationAccess(input: {
  executor: DatabaseSession;
  organizationId: string;
  userId: string;
}): Promise<OrganizationAccess | null> {
  const [organization] = await input.executor
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  if (!organization) {
    throw new OrganizationManagerError("Organization not found", 404);
  }

  const reachableGroupIds = await listUserReachableCurrentGroupIds({
    executor: input.executor,
    groupIds: [organization.adminGroupId, organization.memberGroupId],
    userId: input.userId,
  });

  if (reachableGroupIds.has(organization.adminGroupId)) {
    return { isOrgAdmin: true };
  }
  if (reachableGroupIds.has(organization.memberGroupId)) {
    return { isOrgAdmin: false };
  }

  return null;
}

export async function requireDirectOrganizationAccess(input: {
  executor: DatabaseSession;
  organizationId: string;
  requireAdmin?: boolean;
  userId: string;
}): Promise<OrganizationAccess> {
  const access = await loadOrganizationAccess(input);

  if (!access) {
    throw new OrganizationManagerError("Organization access denied", 403);
  }

  if (input.requireAdmin && !access.isOrgAdmin) {
    throw new OrganizationManagerError("Organization admin required", 403);
  }

  return access;
}
