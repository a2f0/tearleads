import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import type { OrganizationUserDetailResponse } from "@tearleads/validators/response";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import { listOrganizationContainerGrantResponsesInTransaction } from "./grants";
import { listOrganizationGroupSummariesInTransaction } from "./groups";
import { listUserReachableCurrentGroupIds } from "./principalReachability";
import {
  loadOrganizationRosterEntry,
  type OrganizationRosterEntryRow,
  toOrganizationDirectoryUser,
} from "./roster";
import { loadUsersById, type UserKeyRow } from "./users";

type OrganizationUserDetailUser = OrganizationUserDetailResponse["user"];

function toOrganizationUserDetailUser(input: {
  readonly rosterEntry: OrganizationRosterEntryRow;
  readonly sessionUserId: string;
  readonly user: UserKeyRow;
}): OrganizationUserDetailUser {
  return toOrganizationDirectoryUser(input);
}

async function loadOrganizationRosterUser(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly userId: string;
}): Promise<{
  readonly rosterEntry: OrganizationRosterEntryRow;
  readonly user: UserKeyRow;
}> {
  const rosterEntry = await loadOrganizationRosterEntry({
    executor: input.executor,
    organizationId: input.organizationId,
    userId: input.userId,
  });
  if (!rosterEntry) {
    throw new OrganizationManagerError("User not found", 404);
  }

  const usersById = await loadUsersById(input.executor, [input.userId]);
  const user = usersById.get(input.userId);
  if (!user) {
    throw new OrganizationManagerError("User not found", 404);
  }

  return { rosterEntry, user };
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
    const { rosterEntry, user } = await loadOrganizationRosterUser({
      executor: tx,
      organizationId,
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
      user: toOrganizationUserDetailUser({
        rosterEntry,
        sessionUserId,
        user,
      }),
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
