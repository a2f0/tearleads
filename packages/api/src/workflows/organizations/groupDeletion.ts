import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  groups as groupsTable,
  organizations,
  principalEpochKeys,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { currentPrincipalStateHashSql } from "../principals/currentPrincipalStateSql";
import { listOrganizationContainerGrantRows } from "./containerGrants";
import { OrganizationManagerError } from "./errors";

interface OrganizationGroupMutationInput {
  executor: DatabaseSession;
  groupId: string;
  organizationId: string;
}

async function hasCurrentPrincipalReferences(input: {
  executor: DatabaseSession;
  groupId: string;
}): Promise<boolean> {
  const result = await input.executor.execute(sql`
    select 1
    from ${principalMembershipProjection} pmp
    where
      pmp.principal_type in (${"group"}, ${"organization"})
      and pmp.member_principal_type = ${"group"}
      and pmp.member_principal_id = ${input.groupId}
      and pmp.state_hash = ${currentPrincipalStateHashSql({
        principalId: sql`pmp.principal_id`,
        principalType: sql`pmp.principal_type`,
      })}
    limit 1
  `);

  return result.rows.length > 0;
}

export async function requireDeletableOrganizationGroup(
  input: OrganizationGroupMutationInput,
): Promise<void> {
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

  const [group] = await input.executor
    .select({ groupId: groupsTable.id })
    .from(groupsTable)
    .where(
      and(
        eq(groupsTable.id, input.groupId),
        eq(groupsTable.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!group) {
    throw new OrganizationManagerError("Group not found", 404);
  }

  if (
    input.groupId === organization.adminGroupId ||
    input.groupId === organization.memberGroupId
  ) {
    throw new OrganizationManagerError(
      "Built-in groups cannot be deleted",
      409,
    );
  }
}

export async function requireOrganizationGroupWithoutDeleteBlockers(
  input: OrganizationGroupMutationInput,
): Promise<void> {
  const directContainerGrants = await listOrganizationContainerGrantRows({
    executor: input.executor,
    organizationId: input.organizationId,
    subjectFilter: {
      subjectId: input.groupId,
      subjectType: "group",
    },
  });
  if (directContainerGrants.length > 0) {
    throw new OrganizationManagerError(
      "Group has direct container grants",
      409,
    );
  }

  if (
    await hasCurrentPrincipalReferences({
      executor: input.executor,
      groupId: input.groupId,
    })
  ) {
    throw new OrganizationManagerError(
      "Group is referenced by current principal policy",
      409,
    );
  }
}

export async function deleteOrganizationGroupRows(input: {
  executor: DatabaseSession;
  groupId: string;
}): Promise<void> {
  await input.executor
    .delete(principalMemberEnvelopes)
    .where(
      and(
        eq(principalMemberEnvelopes.principalType, "group"),
        eq(principalMemberEnvelopes.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, "group"),
        eq(principalMembershipProjection.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(principalStatePayloads)
    .where(
      and(
        eq(principalStatePayloads.principalType, "group"),
        eq(principalStatePayloads.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, "group"),
        eq(principalEpochKeys.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(principalStates)
    .where(
      and(
        eq(principalStates.principalType, "group"),
        eq(principalStates.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(groupsTable)
    .where(eq(groupsTable.id, input.groupId));
}
