import type { OrganizationUserDetailResponse } from "@tearleads/validators/response";
import type { ApiDatabase, DatabaseSession } from "../../adapters/postgres";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import { listOrganizationContainerGrantResponsesInTransaction } from "./grants";
import { listOrganizationGroupSummariesInTransaction } from "./groups";
import { listUserReachableCurrentGroupIds } from "./principalReachability";
import { loadUsersById, type UserKeyRow } from "./users";

type OrganizationUserDetailUser = OrganizationUserDetailResponse["user"];

function toOrganizationUserDetailUser(input: {
  readonly sessionUserId: string;
  readonly user: UserKeyRow;
}): OrganizationUserDetailUser {
  return {
    userId: input.user.userId,
    signingKeyFingerprint: input.user.signingKeyFingerprint,
    signingPublicKey: input.user.signingPublicKey,
    encapsulationPublicKey: input.user.encapsulationPublicKey,
    encapsulationKeyFingerprint: input.user.encapsulationKeyFingerprint,
    createdAt: input.user.createdAt.toISOString(),
    isSelf: input.user.userId === input.sessionUserId,
  };
}

async function loadOrganizationUser(input: {
  readonly executor: DatabaseSession;
  readonly memberGroupId: string;
  readonly userId: string;
}): Promise<UserKeyRow> {
  const reachableMemberGroupIds = await listUserReachableCurrentGroupIds({
    executor: input.executor,
    groupIds: [input.memberGroupId],
    userId: input.userId,
  });
  if (!reachableMemberGroupIds.has(input.memberGroupId)) {
    throw new OrganizationManagerError("User not found", 404);
  }

  const usersById = await loadUsersById(input.executor, [input.userId]);
  const user = usersById.get(input.userId);
  if (!user) {
    throw new OrganizationManagerError("User not found", 404);
  }

  return user;
}

export async function runGetOrganizationUserDetailWorkflow(
  db: ApiDatabase,
  organizationId: string,
  userId: string,
  sessionUserId: string,
): Promise<OrganizationUserDetailResponse> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });

    const groupSummaries = await listOrganizationGroupSummariesInTransaction({
      executor: tx,
      organizationId,
    });
    const user = await loadOrganizationUser({
      executor: tx,
      memberGroupId: groupSummaries.memberGroupId,
      userId,
    });
    const reachableGroupIds = await listUserReachableCurrentGroupIds({
      executor: tx,
      groupIds: groupSummaries.groups.map((group) => group.groupId),
      userId,
    });
    const groups = groupSummaries.groups.filter((group) =>
      reachableGroupIds.has(group.groupId),
    );
    const grants = await listOrganizationContainerGrantResponsesInTransaction({
      executor: tx,
      organizationId,
      subjectFilters: [
        {
          subjectId: user.userId,
          subjectType: "user",
        },
        ...[...reachableGroupIds].map((groupId) => ({
          subjectId: groupId,
          subjectType: "group" as const,
        })),
        {
          subjectId: organizationId,
          subjectType: "organization",
        },
      ],
    });

    return {
      organizationId,
      user: toOrganizationUserDetailUser({ sessionUserId, user }),
      groups,
      grants: {
        directGrants: grants.filter(
          (grant) =>
            grant.subjectType === "user" && grant.subjectId === user.userId,
        ),
        groupGrants: grants.filter(
          (grant) =>
            grant.subjectType === "group" &&
            reachableGroupIds.has(grant.subjectId),
        ),
        organizationGrants: grants.filter(
          (grant) =>
            grant.subjectType === "organization" &&
            grant.subjectId === organizationId,
        ),
      },
    };
  });
}
