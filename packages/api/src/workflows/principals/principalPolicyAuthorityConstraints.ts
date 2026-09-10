import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { groups, organizations, users } from "@tearleads/api-shared/schema";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import { and, eq, or } from "drizzle-orm";
import { listCurrentPrincipalProjectionMembers } from "../../access/read/principalStateStore";
import { parseOrganizationAuthorityDescriptor } from "../organizations/organizationAuthorityDescriptor";
import {
  assertOrganizationGroupDirectoryCurrent,
  principalProjectionsEqual,
} from "../organizations/organizationGroupDirectoryValidation";
import { PrincipalPolicyError } from "./shared";

interface PrincipalPolicyAuthorityConstraintInput
  extends PutPrincipalPolicyRequest {
  readonly expectedPrincipalId: string;
  readonly expectedPrincipalType: "group" | "organization";
}

export interface OrganizationPolicyTarget {
  readonly organizationId: string;
  readonly memberGroupId: string;
}

async function assertReservedAdminsPolicyShape(
  tx: DatabaseTransaction,
  input: PrincipalPolicyAuthorityConstraintInput,
): Promise<void> {
  if (input.expectedPrincipalType !== "group") {
    return;
  }
  const [organization] = await tx
    .select({ adminGroupId: organizations.adminGroupId })
    .from(groups)
    .innerJoin(organizations, eq(organizations.id, groups.organizationId))
    .where(eq(groups.id, input.expectedPrincipalId))
    .limit(1);
  if (
    !organization ||
    organization.adminGroupId !== input.expectedPrincipalId
  ) {
    return;
  }
  if (
    input.projection.length === 0 ||
    input.projection.some((member) => false || member.role !== "admin")
  ) {
    throw new PrincipalPolicyError(
      "Reserved Admins policy must contain only direct admin users",
      400,
    );
  }
}

async function assertPersonalOrganizationOwnerRetained(
  tx: DatabaseTransaction,
  input: PrincipalPolicyAuthorityConstraintInput,
): Promise<void> {
  if (input.expectedPrincipalType !== "group") {
    return;
  }
  const owners = await tx
    .select({
      userId: users.id,
      adminGroupId: organizations.adminGroupId,
    })
    .from(groups)
    .innerJoin(organizations, eq(organizations.id, groups.organizationId))
    .innerJoin(users, eq(users.defaultOrganizationId, organizations.id))
    .where(
      and(
        eq(groups.id, input.expectedPrincipalId),
        or(
          eq(groups.id, organizations.adminGroupId),
          eq(groups.id, organizations.memberGroupId),
        ),
      ),
    );

  for (const owner of owners) {
    const isAdmins = input.expectedPrincipalId === owner.adminGroupId;
    if (
      !input.projection.some(
        (member) =>
          member.userId === owner.userId &&
          (!isAdmins || member.role === "admin"),
      )
    ) {
      throw new PrincipalPolicyError(
        "Personal organization owner must remain an active member and admin",
        409,
      );
    }
  }
}

async function assertOrganizationAuthorityDescriptor(
  tx: DatabaseTransaction,
  input: PrincipalPolicyAuthorityConstraintInput,
): Promise<void> {
  if (input.expectedPrincipalType !== "organization") {
    return;
  }
  const [organization] = await tx
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, input.expectedPrincipalId))
    .limit(1);
  if (!organization) {
    throw new PrincipalPolicyError("Organization not found", 404);
  }
  const descriptor = parseOrganizationAuthorityDescriptor(
    input.encryptedPayload.ciphertext,
  );
  if (
    !descriptor ||
    descriptor.organizationId !== input.expectedPrincipalId ||
    descriptor.adminGroupId !== organization.adminGroupId ||
    descriptor.memberGroupId !== organization.memberGroupId
  ) {
    throw new PrincipalPolicyError(
      "Organization authority descriptor scope is invalid",
      400,
    );
  }
  if (input.grants.length !== 0) {
    throw new PrincipalPolicyError(
      "Organization policy cannot contain container grants",
      400,
    );
  }
  const adminProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.adminGroupId,
    tx,
  );
  if (!principalProjectionsEqual(input.projection, adminProjection)) {
    throw new PrincipalPolicyError(
      "Organization policy projection must match the current Admins policy",
      400,
    );
  }
  await assertOrganizationGroupDirectoryCurrent({
    directory: descriptor.groupHeads,
    executor: tx,
    organizationId: input.expectedPrincipalId,
  });
}

export async function assertPolicyAuthorityConstraints(
  tx: DatabaseTransaction,
  policy: PrincipalPolicyAuthorityConstraintInput,
): Promise<void> {
  await assertReservedAdminsPolicyShape(tx, policy);
  await assertPersonalOrganizationOwnerRetained(tx, policy);
  await assertOrganizationAuthorityDescriptor(tx, policy);
}
