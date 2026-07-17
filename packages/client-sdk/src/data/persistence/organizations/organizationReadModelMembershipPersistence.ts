import type {
  OrganizationGroupMemberResponse,
  OrganizationGroupMembersResponse,
  OrganizationReadModelGroupMembershipsResponse,
  OrganizationRole,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  organizationReadModelGroupMembers,
  organizationReadModelGroupMemberships,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../sqlite/schema";
import {
  type ClientSQLiteTransaction,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { ORGANIZATION_READ_MODEL_PROTOCOL_VERSION } from "./organizationReadModelProtocol";
import { purgeOrganizationReadModelProjectionInTransaction } from "./organizationReadModelPurge";

const GROUP_MEMBERSHIP_BATCH_SIZE = 90;
const GROUP_MEMBER_INSERT_BATCH_SIZE = 30;

export class OrganizationReadModelBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationReadModelBindingError";
  }
}

interface SelectedGroupMember {
  readonly encapsulationKeyFingerprint: string | null;
  readonly encapsulationPublicKey: string | null;
  readonly memberPrincipalId: string;
  readonly memberPrincipalType: string;
  readonly nestedGroupId: string | null;
  readonly nestedGroupName: string | null;
  readonly role: string;
  readonly signingKeyFingerprint: string | null;
  readonly signingPublicKey: string | null;
  readonly stateHash: string;
  readonly userId: string | null;
}

function membershipMemberKey(
  member: Pick<
    OrganizationGroupMemberResponse,
    "memberPrincipalId" | "memberPrincipalType"
  >,
): string {
  return `${member.memberPrincipalType}:${member.memberPrincipalId}`;
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
  readonly tx: ClientSQLiteTransaction;
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
      memberPrincipalType: member.memberPrincipalType,
      memberPrincipalId: member.memberPrincipalId,
      sortOrder,
      stateHash: group.stateHash,
      role: member.role,
      userId: member.userId,
      signingKeyFingerprint: member.signingKeyFingerprint,
      signingPublicKey: member.signingPublicKey,
      encapsulationPublicKey: member.encapsulationPublicKey,
      encapsulationKeyFingerprint: member.encapsulationKeyFingerprint,
      nestedGroupId: member.groupId,
      nestedGroupName: member.groupName,
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

function requireMemberPrincipalType(
  value: string,
): OrganizationGroupMemberResponse["memberPrincipalType"] {
  if (value !== "user" && value !== "group") {
    throw new Error("Stored organization group member type is invalid");
  }
  return value;
}

function requireOrganizationRole(value: string): OrganizationRole {
  if (value !== "member" && value !== "admin") {
    throw new Error("Stored organization group member role is invalid");
  }
  return value;
}

function toGroupMember(
  row: SelectedGroupMember,
  expectedStateHash: string,
): OrganizationGroupMemberResponse {
  if (row.stateHash !== expectedStateHash) {
    throw new Error(
      "Stored organization group membership state is inconsistent",
    );
  }
  return {
    memberPrincipalType: requireMemberPrincipalType(row.memberPrincipalType),
    memberPrincipalId: row.memberPrincipalId,
    role: requireOrganizationRole(row.role),
    userId: row.userId,
    signingKeyFingerprint: row.signingKeyFingerprint,
    signingPublicKey: row.signingPublicKey,
    encapsulationPublicKey: row.encapsulationPublicKey,
    encapsulationKeyFingerprint: row.encapsulationKeyFingerprint,
    groupId: row.nestedGroupId,
    groupName: row.nestedGroupName,
  };
}

async function loadMembershipRows(input: {
  readonly groupId: string;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransaction;
}): Promise<SelectedGroupMember[]> {
  return input.tx
    .select({
      encapsulationKeyFingerprint:
        organizationReadModelGroupMembers.encapsulationKeyFingerprint,
      encapsulationPublicKey:
        organizationReadModelGroupMembers.encapsulationPublicKey,
      memberPrincipalId: organizationReadModelGroupMembers.memberPrincipalId,
      memberPrincipalType:
        organizationReadModelGroupMembers.memberPrincipalType,
      nestedGroupId: organizationReadModelGroupMembers.nestedGroupId,
      nestedGroupName: organizationReadModelGroupMembers.nestedGroupName,
      role: organizationReadModelGroupMembers.role,
      signingKeyFingerprint:
        organizationReadModelGroupMembers.signingKeyFingerprint,
      signingPublicKey: organizationReadModelGroupMembers.signingPublicKey,
      stateHash: organizationReadModelGroupMembers.stateHash,
      userId: organizationReadModelGroupMembers.userId,
    })
    .from(organizationReadModelGroupMembers)
    .where(
      and(
        eq(
          organizationReadModelGroupMembers.organizationId,
          input.organizationId,
        ),
        eq(organizationReadModelGroupMembers.groupId, input.groupId),
      ),
    )
    .orderBy(
      asc(organizationReadModelGroupMembers.sortOrder),
      asc(organizationReadModelGroupMembers.memberPrincipalType),
      asc(organizationReadModelGroupMembers.memberPrincipalId),
    );
}

async function loadOrganizationReadModelGroupMembersInTransaction(input: {
  readonly groupId: string;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransaction;
}): Promise<OrganizationGroupMembersResponse | null> {
  const [head] = await input.tx
    .select({ stateHash: organizationReadModelGroupMemberships.stateHash })
    .from(organizationReadModelGroupMemberships)
    .where(
      and(
        eq(
          organizationReadModelGroupMemberships.organizationId,
          input.organizationId,
        ),
        eq(organizationReadModelGroupMemberships.groupId, input.groupId),
      ),
    )
    .limit(1);
  if (!head) {
    return null;
  }

  const rows = await loadMembershipRows(input);
  const [group] = await input.tx
    .select({
      memberCount: organizationReadModelGroups.memberCount,
      stateHash: organizationReadModelGroups.stateHash,
    })
    .from(organizationReadModelGroups)
    .where(
      and(
        eq(organizationReadModelGroups.organizationId, input.organizationId),
        eq(organizationReadModelGroups.groupId, input.groupId),
      ),
    )
    .limit(1);
  if (
    group &&
    (group.stateHash !== head.stateHash || group.memberCount !== rows.length)
  ) {
    throw new Error("Stored organization group membership binding is invalid");
  }
  return {
    organizationId: input.organizationId,
    groupId: input.groupId,
    members: rows.map((row) => toGroupMember(row, head.stateHash)),
  };
}

export async function loadOrganizationReadModelGroupMembers(
  execSql: ExecSql,
  organizationId: string,
  groupId: string,
  currentUserId: string,
): Promise<OrganizationGroupMembersResponse | null> {
  await ensureSqlTables(execSql, organizationReadModelTables);
  return getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    const [state] = await tx
      .select({ protocolVersion: organizationReadModelState.protocolVersion })
      .from(organizationReadModelState)
      .where(eq(organizationReadModelState.organizationId, organizationId))
      .limit(1);
    if (!state) {
      return null;
    }
    if (state.protocolVersion !== ORGANIZATION_READ_MODEL_PROTOCOL_VERSION) {
      await purgeOrganizationReadModelProjectionInTransaction({
        organizationId,
        tx,
      });
      return null;
    }
    const [requester] = await tx
      .select({ userId: organizationReadModelRequesters.userId })
      .from(organizationReadModelRequesters)
      .where(
        and(
          eq(organizationReadModelRequesters.organizationId, organizationId),
          eq(organizationReadModelRequesters.userId, currentUserId),
        ),
      )
      .limit(1);
    if (!requester) {
      return null;
    }
    return loadOrganizationReadModelGroupMembersInTransaction({
      groupId,
      organizationId,
      tx,
    });
  });
}

export async function assertStoredGroupMembershipBindings(input: {
  readonly memberGroupId: string;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransaction;
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
