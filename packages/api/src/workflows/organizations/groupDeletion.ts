import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  groups as groupsTable,
  organizationGroupTombstones,
  organizations,
  principalEpochKeys,
  principalMemberEnvelopes,
  principalPolicyMutationAcknowledgements,
  principalStatePayloads,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { OrganizationManagerError } from "./errors";

interface OrganizationGroupMutationInput {
  executor: DatabaseSession;
  groupId: string;
  organizationId: string;
}

async function hasCurrentContainerGrant(input: {
  executor: DatabaseSession;
  groupId: string;
}): Promise<boolean> {
  const [grant] = await input.executor
    .select({ id: accessManifestContainerGrantProjection.id })
    .from(accessManifestContainerGrantProjection)
    .innerJoin(
      accessManifestHeads,
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(
          accessManifestHeads.objectId,
          accessManifestContainerGrantProjection.containerId,
        ),
        eq(
          accessManifestHeads.manifestHash,
          accessManifestContainerGrantProjection.manifestHash,
        ),
      ),
    )
    .where(
      and(
        eq(accessManifestContainerGrantProjection.subjectType, "group"),
        eq(accessManifestContainerGrantProjection.subjectId, input.groupId),
      ),
    )
    .limit(1);

  return grant !== undefined;
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
  if (
    await hasCurrentContainerGrant({
      executor: input.executor,
      groupId: input.groupId,
    })
  ) {
    throw new OrganizationManagerError(
      "Group has direct container grants",
      409,
    );
  }

  // A group used to be blocked from deletion while it was a member of another
  // principal. Principals contain only users now, so no such reference can
  // exist and the guard has nothing left to check.
}

export async function deleteOrganizationGroupRows(input: {
  executor: DatabaseSession;
  groupId: string;
  organizationId: string;
}): Promise<void> {
  await input.executor.insert(organizationGroupTombstones).values({
    groupId: input.groupId,
    organizationId: input.organizationId,
  });
  await input.executor
    .delete(principalPolicyMutationAcknowledgements)
    .where(
      and(
        eq(principalPolicyMutationAcknowledgements.principalType, "group"),
        eq(principalPolicyMutationAcknowledgements.principalId, input.groupId),
      ),
    );
  await input.executor
    .delete(principalMemberEnvelopes)
    .where(
      and(
        eq(principalMemberEnvelopes.principalType, "group"),
        eq(principalMemberEnvelopes.principalId, input.groupId),
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
  // Keep only the signed public state, membership projection, and grant
  // commitments needed to verify terminal proofs. Encrypted payloads and every
  // recoverable key envelope are erased before the catalog row is removed.
  await input.executor
    .delete(groupsTable)
    .where(eq(groupsTable.id, input.groupId));
}
