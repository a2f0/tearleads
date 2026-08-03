import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { groups, organizations } from "@tearleads/api-shared/schema";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { parseOrganizationAuthorityDescriptor } from "../organizations/organizationAuthorityDescriptor";
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
    return;
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
      "Organization authority descriptor cannot change",
      400,
    );
  }
}

export async function assertPolicyAuthorityConstraints(
  tx: DatabaseTransaction,
  policy: PrincipalPolicyAuthorityConstraintInput,
): Promise<void> {
  await assertReservedAdminsPolicyShape(tx, policy);
  await assertOrganizationAuthorityDescriptor(tx, policy);
}
