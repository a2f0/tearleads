import type {
  OrganizationGroupMemberResponse,
  OrganizationReadModelGroupMembershipsResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import {
  organizationReadModelGroupMembers,
  organizationReadModelGroupMemberships,
  organizationReadModelGroups,
} from "../../sqlite/organizationReadModelSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

const GROUP_MEMBERSHIP_BATCH_SIZE = 90;
const GROUP_MEMBER_INSERT_BATCH_SIZE = 30;

export class OrganizationReadModelBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationReadModelBindingError";
  }
}

function membershipMemberKey(
  member: Pick<OrganizationGroupMemberResponse, "userId">,
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
  readonly lane: OrganizationReadModelGroupMembershipsResponse;
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
    .delete(organizationReadModelGroupMemberships)
    .where(
      eq(
        organizationReadModelGroupMemberships.organizationId,
        input.organizationId,
      ),
    )
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
      .delete(organizationReadModelGroupMemberships)
      .where(
        and(
          eq(
            organizationReadModelGroupMemberships.organizationId,
            input.organizationId,
          ),
          inArray(organizationReadModelGroupMemberships.groupId, groupIdBatch),
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

async function insertMembershipRows(
  input: ApplyGroupMembershipsLaneInput,
): Promise<void> {
  if (input.lane.groups.length === 0) {
    return;
  }
  const membershipRows = input.lane.groups.map((group) => ({
    organizationId: input.organizationId,
    groupId: group.groupId,
    stateHash: group.stateHash,
  }));
  for (
    let index = 0;
    index < membershipRows.length;
    index += GROUP_MEMBERSHIP_BATCH_SIZE
  ) {
    await input.tx
      .insert(organizationReadModelGroupMemberships)
      .values(membershipRows.slice(index, index + GROUP_MEMBERSHIP_BATCH_SIZE))
      .run();
  }

  const memberRows = input.lane.groups.flatMap((group) =>
    group.members.map((member, sortOrder) => ({
      organizationId: input.organizationId,
      groupId: group.groupId,
      userId: member.userId,
      sortOrder,
      stateHash: group.stateHash,
      role: member.role,
      signingKeyFingerprint: member.signingKeyFingerprint,
      signingPublicKey: member.signingPublicKey,
      encapsulationPublicKey: member.encapsulationPublicKey,
      encapsulationKeyFingerprint: member.encapsulationKeyFingerprint,
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

export async function applyGroupMembershipsLane(
  input: ApplyGroupMembershipsLaneInput,
): Promise<void> {
  assertUniqueMembershipRows(input.lane);
  await removeExistingMembershipRows(input);
  await insertMembershipRows(input);
}

export async function assertStoredGroupMembershipBindings(input: {
  readonly memberGroupId: string;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const groups = await input.tx
    .select({
      groupId: organizationReadModelGroups.groupId,
      memberCount: organizationReadModelGroups.memberCount,
      stateHash: organizationReadModelGroups.stateHash,
    })
    .from(organizationReadModelGroups)
    .where(
      eq(organizationReadModelGroups.organizationId, input.organizationId),
    );
  const heads = await input.tx
    .select({
      groupId: organizationReadModelGroupMemberships.groupId,
      stateHash: organizationReadModelGroupMemberships.stateHash,
    })
    .from(organizationReadModelGroupMemberships)
    .where(
      eq(
        organizationReadModelGroupMemberships.organizationId,
        input.organizationId,
      ),
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
  const headsByGroupId = new Map(heads.map((head) => [head.groupId, head]));
  const expectedHeadIds = new Set([
    input.memberGroupId,
    ...groups.flatMap((group) => (group.stateHash ? [group.groupId] : [])),
  ]);
  if (
    heads.length !== expectedHeadIds.size ||
    heads.some((head) => !expectedHeadIds.has(head.groupId))
  ) {
    throw new OrganizationReadModelBindingError(
      "Organization group membership coverage is inconsistent",
    );
  }

  const memberCountsByGroupId = new Map<string, number>();
  for (const member of members) {
    const head = headsByGroupId.get(member.groupId);
    if (!head || head.stateHash !== member.stateHash) {
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
    const head = headsByGroupId.get(group.groupId);
    if (group.stateHash === null) {
      continue;
    }
    if (
      !head ||
      head.stateHash !== group.stateHash ||
      group.memberCount === null ||
      group.memberCount !== (memberCountsByGroupId.get(group.groupId) ?? 0)
    ) {
      throw new OrganizationReadModelBindingError(
        "Organization group membership state hash is inconsistent",
      );
    }
  }
}
