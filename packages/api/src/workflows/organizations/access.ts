import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizations,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import type { PrincipalPolicyAuthorization } from "@tearleads/crypto";
import { and, eq, or, sql } from "drizzle-orm";
import {
  getCurrentPrincipalStatesFor,
  principalCurrentStateKey,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { currentPrincipalStateHashSql } from "../principals/currentPrincipalStateSql";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "../principals/getCurrentPrincipalPolicy";
import { PrincipalPolicyError } from "../principals/shared";
import { OrganizationManagerError } from "./errors";
import {
  type OrganizationGroupHead,
  parseOrganizationAuthorityDescriptor,
} from "./organizationAuthorityDescriptor";

/** The organization's immutable reserved group ids. */
export interface OrganizationGroupIds {
  readonly adminGroupId: string;
  readonly memberGroupId: string;
}

interface OrganizationAccess {
  isOrgAdmin: boolean;
  /** Never updated after creation, so callers may reuse them in the transaction. */
  readonly organization: OrganizationGroupIds;
  /** The organization head this decision verified, read in this transaction. */
  readonly organizationState: StoredPrincipalState;
}

function requireOrganizationDescriptorScope(input: {
  readonly adminGroupId: string;
  readonly descriptor: ReturnType<typeof parseOrganizationAuthorityDescriptor>;
  readonly memberGroupId: string;
  readonly organizationId: string;
}) {
  if (
    !input.descriptor ||
    input.descriptor.organizationId !== input.organizationId ||
    input.descriptor.adminGroupId !== input.adminGroupId ||
    input.descriptor.memberGroupId !== input.memberGroupId
  ) {
    throw new PrincipalPolicyError(
      "Stored organization authority descriptor is inconsistent",
      409,
    );
  }
  return input.descriptor;
}

function principalStateMatchesGroupHead(
  state: StoredPrincipalState | undefined,
  head: OrganizationGroupHead | undefined,
): boolean {
  return (
    state !== undefined &&
    head !== undefined &&
    state.principalId === head.principalId &&
    state.version === head.version &&
    state.keyEpoch === head.keyEpoch &&
    state.stateHash === head.stateHash &&
    state.keyFingerprint === head.keyFingerprint
  );
}

async function loadVerifiedOrganizationAccessPolicies(input: {
  readonly adminGroupId: string;
  readonly executor: DatabaseSession;
  readonly memberGroupId: string;
  readonly organizationId: string;
}): Promise<{
  readonly adminPolicy: PrincipalPolicyAuthorization;
  readonly memberPolicy: PrincipalPolicyAuthorization;
  readonly organizationState: StoredPrincipalState;
}> {
  const admin = {
    principalType: "group",
    principalId: input.adminGroupId,
  } as const;
  const member = {
    principalType: "group",
    principalId: input.memberGroupId,
  } as const;
  const organization = {
    principalType: "organization",
    principalId: input.organizationId,
  } as const;
  // One statement reads all three heads, from one snapshot.
  const states = await getCurrentPrincipalStatesFor(
    [admin, member, organization],
    input.executor,
  );
  const adminState = states.get(principalCurrentStateKey(admin));
  const memberState = states.get(principalCurrentStateKey(member));
  const organizationState = states.get(principalCurrentStateKey(organization));
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
    const descriptor = requireOrganizationDescriptorScope({
      adminGroupId: input.adminGroupId,
      descriptor: parseOrganizationAuthorityDescriptor(
        organizationBundle.currentPayload.ciphertext,
      ),
      memberGroupId: input.memberGroupId,
      organizationId: input.organizationId,
    });
    if (
      !principalStateMatchesGroupHead(
        adminState,
        descriptor.groupHeads.find(
          (head) => head.principalId === input.adminGroupId,
        ),
      ) ||
      !principalStateMatchesGroupHead(
        memberState,
        descriptor.groupHeads.find(
          (head) => head.principalId === input.memberGroupId,
        ),
      )
    ) {
      throw new PrincipalPolicyError(
        "Stored organization access policy does not match its signed directory head",
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
    return { adminPolicy, memberPolicy, organizationState };
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

  const { adminPolicy, memberPolicy, organizationState } =
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

  if (isAdmin || isMember) {
    return { isOrgAdmin: isAdmin, organization, organizationState };
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

/**
 * One-statement screen run before a caller takes a shared organization lock:
 * the organization must exist and the user must appear in the current stored
 * projection of its reserved Admins or Members group. It is a filter, not an
 * authorization decision; `requireDirectOrganizationAccess` must still verify
 * the signed policies before any organization data is returned.
 */
export async function requireOrganizationAccessCandidate(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly userId: string;
}): Promise<void> {
  const member = principalMembershipProjection;
  const [row] = await input.executor
    .select({ userId: member.userId })
    .from(organizations)
    .leftJoin(
      member,
      and(
        eq(member.principalType, "group"),
        or(
          eq(member.principalId, organizations.adminGroupId),
          eq(member.principalId, organizations.memberGroupId),
        ),
        eq(member.userId, input.userId),
        eq(
          member.stateHash,
          currentPrincipalStateHashSql({
            principalId: sql`${member.principalId}`,
            principalType: sql`'group'`,
          }),
        ),
      ),
    )
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!row) {
    throw new OrganizationManagerError("Organization not found", 404);
  }
  if (row.userId === null) {
    throw new OrganizationManagerError("Organization access denied", 403);
  }
}
