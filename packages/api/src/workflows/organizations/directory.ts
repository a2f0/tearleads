import type { OrganizationDirectoryResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import type { ApiDatabase, DatabaseSession } from "../../adapters/postgres";
import { organizations } from "../../schema";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import { listUsersReachableFromCurrentGroup } from "./principalReachability";
import { loadUsersById } from "./users";

type OrganizationDirectoryUser = OrganizationDirectoryResponse["users"][number];

function compareOrganizationDirectoryUsers(
  left: OrganizationDirectoryUser,
  right: OrganizationDirectoryUser,
): number {
  return left.userId.localeCompare(right.userId);
}

async function loadMemberGroupId(input: {
  executor: DatabaseSession;
  organizationId: string;
}): Promise<string> {
  const [organization] = await input.executor
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  if (!organization) {
    throw new OrganizationManagerError("Organization not found", 404);
  }

  return organization.memberGroupId;
}

export async function runListOrganizationDirectoryWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationDirectoryResponse> {
  return db.transaction(async (tx) => {
    const access = await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });
    const memberGroupId = await loadMemberGroupId({
      executor: tx,
      organizationId,
    });
    const memberUserIds = await listUsersReachableFromCurrentGroup({
      executor: tx,
      groupId: memberGroupId,
    });

    const usersById = await loadUsersById(tx, memberUserIds);

    return {
      organizationId,
      currentUser: {
        isOrgAdmin: access.isOrgAdmin,
      },
      users: memberUserIds
        .flatMap((userId) => {
          const user = usersById.get(userId);
          if (!user) {
            return [];
          }

          return [
            {
              userId: user.userId,
              signingKeyFingerprint: user.signingKeyFingerprint,
              signingPublicKey: user.signingPublicKey,
              encapsulationPublicKey: user.encapsulationPublicKey,
              encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
              createdAt: user.createdAt.toISOString(),
              isSelf: user.userId === sessionUserId,
            },
          ];
        })
        .sort(compareOrganizationDirectoryUsers),
    };
  });
}
