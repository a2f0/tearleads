import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "../principals/getCurrentPrincipalPolicy";
import { PrincipalPolicyError } from "../principals/shared";
import { OrganizationManagerError } from "./errors";
import { parseOrganizationAuthorityDescriptor } from "./organizationAuthorityDescriptor";

interface OrganizationAccess {
  isOrgAdmin: boolean;
}

async function loadVerifiedOrganizationAccessPolicies(input: {
  readonly adminGroupId: string;
  readonly executor: DatabaseSession;
  readonly memberGroupId: string;
  readonly organizationId: string;
}): Promise<{
  readonly adminPolicy: VerifiedPrincipalPolicy;
  readonly memberPolicy: VerifiedPrincipalPolicy;
}> {
  const adminState = await getCurrentPrincipalState(
    "group",
    input.adminGroupId,
    input.executor,
  );
  const memberState = await getCurrentPrincipalState(
    "group",
    input.memberGroupId,
    input.executor,
  );
  const organizationState = await getCurrentPrincipalState(
    "organization",
    input.organizationId,
    input.executor,
  );
  if (!adminState || !memberState || !organizationState) {
    throw new OrganizationManagerError(
      "Organization access policy is missing",
      409,
    );
  }

  try {
    const { bundle: organizationBundle } =
      await getVerifiedPrincipalPolicyForStateWithExecutor(
        input.executor,
        organizationState,
      );
    const authorityDescriptor = parseOrganizationAuthorityDescriptor(
      organizationBundle.currentPayload.ciphertext,
    );
    if (
      !authorityDescriptor ||
      authorityDescriptor.organizationId !== input.organizationId ||
      authorityDescriptor.adminGroupId !== input.adminGroupId ||
      authorityDescriptor.memberGroupId !== input.memberGroupId
    ) {
      throw new PrincipalPolicyError(
        "Stored organization authority descriptor is inconsistent",
        409,
      );
    }
    const { policy: adminPolicy } =
      await getVerifiedPrincipalPolicyForStateWithExecutor(
        input.executor,
        adminState,
      );
    const { policy: memberPolicy } =
      await getVerifiedPrincipalPolicyForStateWithExecutor(
        input.executor,
        memberState,
      );
    return { adminPolicy, memberPolicy };
  } catch (error) {
    if (error instanceof PrincipalPolicyError) {
      throw new OrganizationManagerError(
        "Organization access policy failed integrity verification",
        409,
      );
    }
    throw error;
  }
}

async function loadOrganizationAccess(input: {
  executor: DatabaseSession;
  organizationId: string;
  userId: string;
}): Promise<OrganizationAccess | null> {
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

  const { adminPolicy, memberPolicy } =
    await loadVerifiedOrganizationAccessPolicies({
      adminGroupId: organization.adminGroupId,
      executor: input.executor,
      memberGroupId: organization.memberGroupId,
      organizationId: input.organizationId,
    });
  const isAdmin = adminPolicy.projection.some(
    (member) => member.userId === input.userId && member.role === "admin",
  );
  const isMember = memberPolicy.projection.some(
    (member) => member.userId === input.userId,
  );

  if (isAdmin) {
    return { isOrgAdmin: true };
  }
  if (isMember) {
    return { isOrgAdmin: false };
  }

  return null;
}

export async function requireDirectOrganizationAccess(input: {
  executor: DatabaseSession;
  organizationId: string;
  requireAdmin?: boolean;
  userId: string;
}): Promise<OrganizationAccess> {
  const access = await loadOrganizationAccess(input);

  if (!access) {
    throw new OrganizationManagerError("Organization access denied", 403);
  }

  if (input.requireAdmin && !access.isOrgAdmin) {
    throw new OrganizationManagerError("Organization admin required", 403);
  }

  return access;
}
