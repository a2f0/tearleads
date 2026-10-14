import type {
  OrganizationReadModelGroupMemberResponse,
  OrganizationRole,
} from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import {
  organizationReadModelGroupMembers,
  organizationReadModelGroupMemberships,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/organizationReadModelSchema";
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

async function loadOrganizationReadModelGroupMembersInTransaction(input: {
  readonly groupId: string;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<OrganizationReadModelGroupMembers | null> {
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
        .select({ organizationId: organizationReadModelState.organizationId })
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
        organizationId,
        tx,
      });
    },
  });
}
