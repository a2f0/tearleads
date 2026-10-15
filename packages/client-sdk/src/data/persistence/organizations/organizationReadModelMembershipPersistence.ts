import type {
  OrganizationReadModelGroupMemberResponse,
  OrganizationReadModelGroupMembershipsResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  organizationReadModelGroupMembers,
  organizationReadModelGroups,
} from "../../sqlite/organizationReadModelSchema";
import {
  sqliteInsertBatchSize,
  sqliteRowsPerStatement,
} from "../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

// Group ID lists bind one value per group; the head-clearing update also
// binds its null value beside the organization ID.
const GROUP_MEMBERSHIP_BATCH_SIZE = sqliteRowsPerStatement(1, 2);
// Each head binds two values in its CASE arm and one in the IN list, plus the
// organization ID.
const GROUP_HEAD_UPDATE_BATCH_SIZE = sqliteRowsPerStatement(3, 1);
const GROUP_MEMBER_INSERT_BATCH_SIZE = sqliteInsertBatchSize(
  organizationReadModelGroupMembers,
);

export class OrganizationReadModelBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationReadModelBindingError";
  }
}

function membershipCoverageError(): OrganizationReadModelBindingError {
  return new OrganizationReadModelBindingError(
    "Organization group membership coverage is inconsistent",
  );
}

function membershipMemberKey(
  member: Pick<OrganizationReadModelGroupMemberResponse, "userId">,
): string {
  return member.userId;
}

function assertUniqueMembershipRows(
  lane: OrganizationReadModelGroupMembershipsResponse,
): void {
  const groupIds = lane.groups.map((group) => group.groupId);
  if (new Set(groupIds).size !== groupIds.length) {
    throw new Error(
      "Organization read-model group memberships contain duplicate groups",
    );
  }
  if (new Set(lane.deletedGroupIds).size !== lane.deletedGroupIds.length) {
    throw new Error(
      "Organization read-model group memberships contain duplicate deletions",
    );
  }
  const deletedGroupIds = new Set(lane.deletedGroupIds);
  if (groupIds.some((groupId) => deletedGroupIds.has(groupId))) {
    throw new Error(
      "Organization read-model group membership is both replaced and deleted",
    );
  }
  for (const group of lane.groups) {
    const memberKeys = group.members.map(membershipMemberKey);
    if (new Set(memberKeys).size !== memberKeys.length) {
      throw new Error(
        "Organization read-model group membership contains duplicate members",
      );
    }
  }
}

interface ApplyGroupMembershipsLaneInput {
  /** The reserved Members head before this lane applies. */
  readonly currentMemberGroupStateHash: string | null;
  readonly lane: OrganizationReadModelGroupMembershipsResponse;
  readonly memberGroupId: string;
  readonly organizationId: string;
  readonly replaceAll: boolean;
  readonly tx: ClientSQLiteTransactionScope;
}

async function clearMembershipRows(
  input: ApplyGroupMembershipsLaneInput,
): Promise<void> {
  await input.tx
    .delete(organizationReadModelGroupMembers)
    .where(
      eq(
        organizationReadModelGroupMembers.organizationId,
        input.organizationId,
      ),
    )
    .run();
  await input.tx
    .update(organizationReadModelGroups)
    .set({ membersStateHash: null })
    .where(eq(organizationReadModelGroups.organizationId, input.organizationId))
    .run();
}

async function deleteMembershipRows(
  input: ApplyGroupMembershipsLaneInput,
  groupIds: string[],
): Promise<void> {
  for (
    let index = 0;
    index < groupIds.length;
    index += GROUP_MEMBERSHIP_BATCH_SIZE
  ) {
    const groupIdBatch = groupIds.slice(
      index,
      index + GROUP_MEMBERSHIP_BATCH_SIZE,
    );
    await input.tx
      .delete(organizationReadModelGroupMembers)
      .where(
        and(
          eq(
            organizationReadModelGroupMembers.organizationId,
            input.organizationId,
          ),
          inArray(organizationReadModelGroupMembers.groupId, groupIdBatch),
        ),
      )
      .run();
    await input.tx
      .update(organizationReadModelGroups)
      .set({ membersStateHash: null })
      .where(
        and(
          eq(organizationReadModelGroups.organizationId, input.organizationId),
          inArray(organizationReadModelGroups.groupId, groupIdBatch),
        ),
      )
      .run();
  }
}

async function removeExistingMembershipRows(
  input: ApplyGroupMembershipsLaneInput,
): Promise<void> {
  if (input.replaceAll) {
    if (input.lane.deletedGroupIds.length > 0) {
      throw new Error("Organization membership snapshot contains deletions");
    }
    return clearMembershipRows(input);
  }
  const replacedGroupIds = input.lane.groups.map((group) => group.groupId);
  const removedGroupIds = [...replacedGroupIds, ...input.lane.deletedGroupIds];
  if (removedGroupIds.length > 0) {
    await deleteMembershipRows(input, removedGroupIds);
  }
}

/**
 * Record each visible group's membership head on its catalog row. A head for
 * a group the catalog does not list cannot be bound and fails the page. The
 * reserved Members head binds to the state row instead; the catalog normally
 * omits Members, so its row is updated only when one exists.
 */
async function writeVisibleGroupHeads(
  input: ApplyGroupMembershipsLaneInput,
): Promise<void> {
  const memberGroupHead = input.lane.groups.find(
    (group) => group.groupId === input.memberGroupId,
  );
  if (memberGroupHead) {
    await input.tx
      .update(organizationReadModelGroups)
      .set({ membersStateHash: memberGroupHead.stateHash })
      .where(
        and(
          eq(organizationReadModelGroups.organizationId, input.organizationId),
          eq(organizationReadModelGroups.groupId, input.memberGroupId),
        ),
      )
      .run();
  }
  const heads = input.lane.groups.filter(
    (group) => group.groupId !== input.memberGroupId,
  );
  for (
    let index = 0;
    index < heads.length;
    index += GROUP_HEAD_UPDATE_BATCH_SIZE
  ) {
    const batch = heads.slice(index, index + GROUP_HEAD_UPDATE_BATCH_SIZE);
    const arms = sql.join(
      batch.map((head) => sql`WHEN ${head.groupId} THEN ${head.stateHash}`),
      sql` `,
    );
    const updated = await input.tx
      .update(organizationReadModelGroups)
      .set({
        membersStateHash: sql`CASE ${organizationReadModelGroups.groupId} ${arms} END`,
      })
      .where(
        and(
          eq(organizationReadModelGroups.organizationId, input.organizationId),
          inArray(
            organizationReadModelGroups.groupId,
            batch.map((head) => head.groupId),
          ),
        ),
      )
      .returning({ groupId: organizationReadModelGroups.groupId });
    if (updated.length !== batch.length) {
      throw membershipCoverageError();
    }
  }
}

async function insertMemberRows(
  input: ApplyGroupMembershipsLaneInput,
): Promise<void> {
  const memberRows = input.lane.groups.flatMap((group) =>
    group.members.map((member, sortOrder) => ({
      organizationId: input.organizationId,
      groupId: group.groupId,
      userId: member.userId,
      sortOrder,
      stateHash: group.stateHash,
      role: member.role,
    })),
  );
  for (
    let index = 0;
    index < memberRows.length;
    index += GROUP_MEMBER_INSERT_BATCH_SIZE
  ) {
    await input.tx
      .insert(organizationReadModelGroupMembers)
      .values(memberRows.slice(index, index + GROUP_MEMBER_INSERT_BATCH_SIZE))
      .run();
  }
}

function nextMemberGroupStateHash(
  input: ApplyGroupMembershipsLaneInput,
): string | null {
  const head = input.lane.groups.find(
    (group) => group.groupId === input.memberGroupId,
  );
  if (head) {
    return head.stateHash;
  }
  return input.replaceAll ||
    input.lane.deletedGroupIds.includes(input.memberGroupId)
    ? null
    : input.currentMemberGroupStateHash;
}

/**
 * Apply one groupMemberships lane and return the reserved Members head, which
 * the caller persists on the organization state row.
 */
export async function applyGroupMembershipsLane(
  input: ApplyGroupMembershipsLaneInput,
): Promise<string | null> {
  assertUniqueMembershipRows(input.lane);
  await removeExistingMembershipRows(input);
  await writeVisibleGroupHeads(input);
  await insertMemberRows(input);
  return nextMemberGroupStateHash(input);
}

interface StoredGroupHead {
  readonly groupId: string;
  readonly memberCount: number | null;
  readonly membersStateHash: string | null;
  readonly stateHash: string | null;
}

function membershipHeadsByGroupId(input: {
  readonly groups: readonly StoredGroupHead[];
  readonly memberGroupId: string;
  readonly memberGroupStateHash: string | null;
}): Map<string, string> {
  if (input.memberGroupStateHash === null) {
    throw membershipCoverageError();
  }
  const heads = new Map([[input.memberGroupId, input.memberGroupStateHash]]);
  for (const group of input.groups) {
    if (group.membersStateHash === null) {
      continue;
    }
    // A head is expected exactly for stateful visible groups; a listed
    // Members row must carry the same head as the state row.
    const isMemberGroup = group.groupId === input.memberGroupId;
    if (
      group.stateHash === null ||
      (isMemberGroup
        ? group.membersStateHash !== input.memberGroupStateHash
        : heads.has(group.groupId))
    ) {
      throw membershipCoverageError();
    }
    heads.set(group.groupId, group.membersStateHash);
  }
  return heads;
}

export async function assertStoredGroupMembershipBindings(input: {
  readonly memberGroupId: string;
  readonly memberGroupStateHash: string | null;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const groups = await input.tx
    .select({
      groupId: organizationReadModelGroups.groupId,
      memberCount: organizationReadModelGroups.memberCount,
      membersStateHash: organizationReadModelGroups.membersStateHash,
      stateHash: organizationReadModelGroups.stateHash,
    })
    .from(organizationReadModelGroups)
    .where(
      eq(organizationReadModelGroups.organizationId, input.organizationId),
    );
  const members = await input.tx
    .select({
      groupId: organizationReadModelGroupMembers.groupId,
      stateHash: organizationReadModelGroupMembers.stateHash,
    })
    .from(organizationReadModelGroupMembers)
    .where(
      eq(
        organizationReadModelGroupMembers.organizationId,
        input.organizationId,
      ),
    );
  const headsByGroupId = membershipHeadsByGroupId({ ...input, groups });

  const memberCountsByGroupId = new Map<string, number>();
  for (const member of members) {
    if (headsByGroupId.get(member.groupId) !== member.stateHash) {
      throw new OrganizationReadModelBindingError(
        "Organization group membership member state is inconsistent",
      );
    }
    memberCountsByGroupId.set(
      member.groupId,
      (memberCountsByGroupId.get(member.groupId) ?? 0) + 1,
    );
  }

  for (const group of groups) {
    if (group.stateHash === null) {
      continue;
    }
    if (
      group.membersStateHash !== group.stateHash ||
      group.memberCount === null ||
      group.memberCount !== (memberCountsByGroupId.get(group.groupId) ?? 0)
    ) {
      throw new OrganizationReadModelBindingError(
        "Organization group membership state hash is inconsistent",
      );
    }
  }
}
