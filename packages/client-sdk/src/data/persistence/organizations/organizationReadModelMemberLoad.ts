import type {
  OrganizationReadModelGroupMemberResponse,
  OrganizationRole,
} from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import {
  organizationReadModelGroupMembers,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/schema/organizationReadModelSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { OrganizationReadModelIntegrityError } from "./organizationReadModelProtocol";
import { loadWithOrganizationReadModelIntegrityPurge } from "./organizationReadModelPurge";

interface SelectedGroupMember {
  readonly userId: string;
  readonly role: string;
  readonly stateHash: string;
}

/** Locally projected members of one group, by user and role. */
export interface OrganizationReadModelGroupMembers {
  readonly groupId: string;
  readonly members: OrganizationReadModelGroupMemberResponse[];
  readonly organizationId: string;
}

function requireOrganizationRole(value: string): OrganizationRole {
  if (value !== "member" && value !== "admin") {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization group member role is invalid",
    );
  }
  return value;
}

function toGroupMember(
  row: SelectedGroupMember,
  expectedStateHash: string,
): OrganizationReadModelGroupMemberResponse {
  if (row.stateHash !== expectedStateHash) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization group membership state is inconsistent",
    );
  }
  return {
    userId: row.userId,
    role: requireOrganizationRole(row.role),
  };
}

async function loadMembershipRows(input: {
  readonly groupId: string;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<SelectedGroupMember[]> {
  return input.tx
    .select({
      userId: organizationReadModelGroupMembers.userId,
      role: organizationReadModelGroupMembers.role,
      stateHash: organizationReadModelGroupMembers.stateHash,
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
      asc(organizationReadModelGroupMembers.userId),
    );
}

interface StoredMembershipHead {
  readonly memberCount: number | null;
  readonly stateHash: string;
}

/** The reserved Members head lives on the state row; others on catalog rows. */
async function loadMembershipHead(input: {
  readonly groupId: string;
  readonly memberGroup: {
    readonly groupId: string;
    readonly stateHash: string;
  };
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<StoredMembershipHead | null> {
  if (input.groupId === input.memberGroup.groupId) {
    return { memberCount: null, stateHash: input.memberGroup.stateHash };
  }
  const [group] = await input.tx
    .select({
      memberCount: organizationReadModelGroups.memberCount,
      membersStateHash: organizationReadModelGroups.membersStateHash,
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
  if (!group?.membersStateHash) {
    return null;
  }
  if (group.stateHash !== group.membersStateHash) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization group membership binding is invalid",
    );
  }
  return { memberCount: group.memberCount, stateHash: group.membersStateHash };
}

async function loadOrganizationReadModelGroupMembersInTransaction(input: {
  readonly groupId: string;
  readonly memberGroup: {
    readonly groupId: string;
    readonly stateHash: string;
  };
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<OrganizationReadModelGroupMembers | null> {
  const head = await loadMembershipHead(input);
  if (!head) {
    return null;
  }
  const rows = await loadMembershipRows(input);
  if (head.memberCount !== null && head.memberCount !== rows.length) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization group membership binding is invalid",
    );
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
): Promise<OrganizationReadModelGroupMembers | null> {
  return loadWithOrganizationReadModelIntegrityPurge({
    execSql,
    organizationId,
    load: async (tx) => {
      const [state] = await tx
        .select({
          memberGroupId: organizationReadModelState.memberGroupId,
          memberGroupStateHash: organizationReadModelState.memberGroupStateHash,
        })
        .from(organizationReadModelState)
        .where(eq(organizationReadModelState.organizationId, organizationId))
        .limit(1);
      if (!state) {
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
        memberGroup: {
          groupId: state.memberGroupId,
          stateHash: state.memberGroupStateHash,
        },
        organizationId,
        tx,
      });
    },
  });
}
