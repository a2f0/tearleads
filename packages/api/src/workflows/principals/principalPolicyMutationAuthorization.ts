import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import { groups, organizations } from "@symcrypt/api-shared/schema";
import { computePrincipalStateHash } from "@symcrypt/crypto";
import type { PutPrincipalPolicyRequest } from "@symcrypt/validators/request";
import { eq } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { wasOrganizationGroupDeleted } from "../organizations/groupTombstone";
import { isCurrentOrganizationAdminAuthority } from "../organizations/principalPolicyExternalAuthority";
import {
  lockOrganizationReadModelHeadForUpdateInTransaction,
  lockOrganizationReadModelHeadInTransaction,
} from "../organizations/readModelChanges";
import type { OrganizationPolicyTarget } from "./principalPolicyAuthorityConstraints";
import { PrincipalPolicyError } from "./shared";

export interface PutPrincipalPolicyInput extends PutPrincipalPolicyRequest {
  expectedPrincipalId: string;
  expectedPrincipalType: "group" | "organization";
  requesterUserId: string;
}

function policyTargetChanged(): PrincipalPolicyError {
  return new PrincipalPolicyError(
    "Organization policy target changed during mutation",
    409,
  );
}

export async function loadRosterSyncTargetForPrincipal(input: {
  readonly input: PutPrincipalPolicyInput;
  readonly tx: DatabaseTransaction;
}): Promise<OrganizationPolicyTarget | null> {
  if (input.input.expectedPrincipalType === "organization") {
    const [organization] = await input.tx
      .select({
        organizationId: organizations.id,
        memberGroupId: organizations.memberGroupId,
      })
      .from(organizations)
      .where(eq(organizations.id, input.input.expectedPrincipalId))
      .limit(1);
    return organization ?? null;
  }

  const [organization] = await input.tx
    .select({
      organizationId: organizations.id,
      memberGroupId: organizations.memberGroupId,
    })
    .from(groups)
    .innerJoin(organizations, eq(organizations.id, groups.organizationId))
    .where(eq(groups.id, input.input.expectedPrincipalId))
    .limit(1);
  return organization ?? null;
}

export async function isOrgAdminAuthorizedPrincipalPolicySigner(
  tx: DatabaseTransaction,
  input: PutPrincipalPolicyInput,
  signerUserId: string,
): Promise<boolean> {
  if (input.expectedPrincipalType === "organization") {
    return false;
  }
  const [group] = await tx
    .select({
      adminGroupId: organizations.adminGroupId,
      organizationId: organizations.id,
    })
    .from(groups)
    .innerJoin(organizations, eq(organizations.id, groups.organizationId))
    .where(eq(groups.id, input.expectedPrincipalId))
    .limit(1);
  return Boolean(
    group &&
      (await isCurrentOrganizationAdminAuthority({
        executor: tx,
        organizationId: group.organizationId,
        signerUserId,
        submittedAuthority: input.state.externalAuthority,
      })),
  );
}

async function lockExactReplayTarget(input: {
  readonly policy: PutPrincipalPolicyInput;
  readonly submittedStateHash: string;
  readonly target: OrganizationPolicyTarget;
  readonly tx: DatabaseTransaction;
}): Promise<OrganizationPolicyTarget> {
  const lockedHead = await lockOrganizationReadModelHeadInTransaction(
    input.tx,
    input.target.organizationId,
  );
  const lockedTarget = await loadRosterSyncTargetForPrincipal({
    input: input.policy,
    tx: input.tx,
  });
  const lockedState = await getCurrentPrincipalState(
    input.policy.expectedPrincipalType,
    input.policy.expectedPrincipalId,
    input.tx,
  );
  if (
    !lockedTarget ||
    lockedHead === null ||
    lockedTarget.organizationId !== input.target.organizationId ||
    lockedState?.stateHash !== input.submittedStateHash
  ) {
    throw policyTargetChanged();
  }
  return lockedTarget;
}

export async function lockOrganizationReadModelForPolicyMutation(
  tx: DatabaseTransaction,
  input: PutPrincipalPolicyInput,
): Promise<OrganizationPolicyTarget | null> {
  const target = await loadRosterSyncTargetForPrincipal({ input, tx });
  if (!target) {
    if (
      input.expectedPrincipalType === "group" &&
      (await wasOrganizationGroupDeleted({
        executor: tx,
        groupId: input.expectedPrincipalId,
      }))
    ) {
      throw new PrincipalPolicyError(
        "Deleted organization group policies cannot be replayed",
        409,
      );
    }
    return null;
  }
  const currentState = await getCurrentPrincipalState(
    input.expectedPrincipalType,
    input.expectedPrincipalId,
    tx,
  );
  const submittedStateHash = await computePrincipalStateHash(input.state);
  if (currentState?.stateHash === submittedStateHash) {
    return lockExactReplayTarget({
      policy: input,
      submittedStateHash,
      target,
      tx,
    });
  }
  const authorizationProjection = currentState
    ? await listCurrentPrincipalProjectionMembers(
        input.expectedPrincipalType,
        input.expectedPrincipalId,
        tx,
      )
    : input.projection;
  if (input.expectedPrincipalType === "group") {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId: target.organizationId,
      requireAdmin: true,
      userId: input.state.signerUserId,
    });
  }
  const isDirectAdmin = authorizationProjection.some(
    (member) =>
      member.userId === input.state.signerUserId && member.role === "admin",
  );
  if (
    input.expectedPrincipalType === "organization" &&
    !isDirectAdmin &&
    !(await isOrgAdminAuthorizedPrincipalPolicySigner(
      tx,
      input,
      input.state.signerUserId,
    ))
  ) {
    throw new PrincipalPolicyError(
      "Principal state signer must be an admin",
      403,
    );
  }
  const headLocked = await lockOrganizationReadModelHeadForUpdateInTransaction(
    tx,
    target.organizationId,
  );
  if (!headLocked) {
    throw new Error("Organization read-model cursor head is missing");
  }
  const lockedTarget = await loadRosterSyncTargetForPrincipal({ input, tx });
  if (!lockedTarget || lockedTarget.organizationId !== target.organizationId) {
    throw policyTargetChanged();
  }
  return lockedTarget;
}
