import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import { computePrincipalStateHash } from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { reconcileOrganizationBillingSeats } from "../billing/organizationSeats";
import { wasOrganizationGroupDeleted } from "../organizations/groupTombstone";
import { isCurrentOrganizationAdminAuthority } from "../organizations/principalPolicyExternalAuthority";
import { listUsersReachableFromCurrentPrincipal } from "../organizations/principalReachability";
import {
  appendOrganizationReadModelChangeInTransaction,
  lockOrganizationReadModelHeadForUpdateInTransaction,
  lockOrganizationReadModelHeadInTransaction,
} from "../organizations/readModelChanges";
import { syncOrganizationRosterFromMemberReachability } from "../organizations/roster";
import { persistPrincipalPolicyAccessLossTombstones } from "./accessLossTombstones";
import { getPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import { assertPrincipalOrganizationCanSync } from "./organizationSync";
import { lockPrincipalMutationInTransaction } from "./principalMutationLock";
import {
  assertPolicyAuthorityConstraints,
  type OrganizationPolicyTarget,
} from "./principalPolicyAuthorityConstraints";
import { assertPrincipalPolicyGroupReferencesExist } from "./principalPolicyGroupReferences";
import { PrincipalPolicyError, toPrincipalPolicyError } from "./shared";
import { storeVerifiedPrincipalPolicyInTransaction } from "./storeVerifiedPrincipalPolicy";

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

async function isOrgAdminAuthorizedPrincipalPolicySigner(
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

  if (!group) {
    return false;
  }

  return isCurrentOrganizationAdminAuthority({
    executor: tx,
    organizationId: group.organizationId,
    signerUserId,
    submittedAuthority: input.state.externalAuthority,
  });
}

async function loadRosterSyncTargetForPrincipal(input: {
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

async function assertManagedPrincipalUsersAreNotDisabledRosterEntries(input: {
  readonly organizationId: string;
  readonly principalId: string;
  readonly principalType: "group" | "organization";
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  const reachableUserIds = await listUsersReachableFromCurrentPrincipal({
    executor: input.tx,
    principalId: input.principalId,
    principalType: input.principalType,
  });
  if (reachableUserIds.length === 0) {
    return;
  }

  const disabledRows = await input.tx
    .select({ userId: organizationRosterEntries.userId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, input.organizationId),
        eq(organizationRosterEntries.status, "disabled"),
        inArray(organizationRosterEntries.userId, reachableUserIds),
      ),
    );
  if (disabledRows.length > 0) {
    throw new PrincipalPolicyError(
      "Principal contains disabled organization users",
      409,
    );
  }
}

async function syncRosterForStoredPrincipalState(input: {
  readonly request: PutPrincipalPolicyInput;
  readonly tx: DatabaseTransaction;
}): Promise<{
  changedRosterUserIds: string[];
  organizationId: string;
  memberGroupId: string;
} | null> {
  const rosterSyncTarget = await loadRosterSyncTargetForPrincipal({
    input: input.request,
    tx: input.tx,
  });
  if (!rosterSyncTarget) {
    return null;
  }

  const changedRosterUserIds =
    await syncOrganizationRosterFromMemberReachability({
      disabledByUserId: input.request.state.signerUserId,
      executor: input.tx,
      memberGroupId: rosterSyncTarget.memberGroupId,
      organizationId: rosterSyncTarget.organizationId,
    });
  if (
    input.request.expectedPrincipalType === "organization" ||
    input.request.expectedPrincipalId !== rosterSyncTarget.memberGroupId
  ) {
    await assertManagedPrincipalUsersAreNotDisabledRosterEntries({
      organizationId: rosterSyncTarget.organizationId,
      principalId: input.request.expectedPrincipalId,
      principalType: input.request.expectedPrincipalType,
      tx: input.tx,
    });
  }
  return { ...rosterSyncTarget, changedRosterUserIds };
}

function assertPutPrincipalPolicyRouteBinding(
  input: PutPrincipalPolicyInput,
): void {
  if (input.state.signerUserId !== input.requesterUserId) {
    throw new PrincipalPolicyError(
      "Principal policy signer does not match authenticated requester",
      403,
    );
  }
  if (input.state.principalType !== input.expectedPrincipalType) {
    throw new PrincipalPolicyError(
      "Principal state principalType does not match route principal",
      400,
    );
  }
  if (input.state.principalId !== input.expectedPrincipalId) {
    throw new PrincipalPolicyError(
      "Principal state principalId does not match route principal",
      400,
    );
  }
  if (
    input.expectedPrincipalType === "organization" &&
    input.state.externalAuthority !== null
  ) {
    throw new PrincipalPolicyError(
      "Organization policies cannot cite external authority",
      400,
    );
  }
}

async function lockOrganizationReadModelForPolicyMutation(
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
  const isExactReplay = currentState?.stateHash === submittedStateHash;
  if (isExactReplay) {
    const lockedHead = await lockOrganizationReadModelHeadInTransaction(
      tx,
      target.organizationId,
    );
    const lockedTarget = await loadRosterSyncTargetForPrincipal({ input, tx });
    const lockedState = await getCurrentPrincipalState(
      input.expectedPrincipalType,
      input.expectedPrincipalId,
      tx,
    );
    if (
      !lockedTarget ||
      lockedHead === null ||
      lockedTarget.organizationId !== target.organizationId ||
      lockedState?.stateHash !== submittedStateHash
    ) {
      throw policyTargetChanged();
    }
    return lockedTarget;
  }
  const authorizationProjection = currentState
    ? await listCurrentPrincipalProjectionMembers(
        input.expectedPrincipalType,
        input.expectedPrincipalId,
        tx,
      )
    : input.projection;
  const isDirectAdmin = authorizationProjection.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === input.state.signerUserId &&
      member.role === "admin",
  );
  const isOrganizationAdmin =
    !isDirectAdmin &&
    (await isOrgAdminAuthorizedPrincipalPolicySigner(
      tx,
      input,
      input.state.signerUserId,
    ));
  if (!isDirectAdmin && !isOrganizationAdmin) {
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

async function lockPolicyPrincipalMutation(
  tx: DatabaseTransaction,
  input: PutPrincipalPolicyInput,
): Promise<void> {
  await lockPrincipalMutationInTransaction(
    tx,
    input.expectedPrincipalType,
    input.expectedPrincipalId,
  );
  await assertPrincipalPolicyGroupReferencesExist({
    projection: input.projection,
    tx,
  });
}

export async function runPutPrincipalPolicyWorkflow(
  db: ApiDatabase,
  input: PutPrincipalPolicyInput,
): Promise<PrincipalPolicyBundleResponse> {
  assertPutPrincipalPolicyRouteBinding(input);

  try {
    return await db.transaction(async (tx) => {
      await lockPolicyPrincipalMutation(tx, input);
      const organizationTarget =
        await lockOrganizationReadModelForPolicyMutation(tx, input);
      await assertPolicyAuthorityConstraints(tx, organizationTarget, input);
      const previousState = await getCurrentPrincipalState(
        input.state.principalType,
        input.state.principalId,
        tx,
      );
      const nextState = await storeVerifiedPrincipalPolicyInTransaction(
        {
          state: input.state,
          encryptedPayload: input.encryptedPayload,
          projection: input.projection,
          memberEnvelopes: input.memberEnvelopes,
        },
        tx,
        {
          authorizeExternalAdminSigner: (authorization) =>
            isOrgAdminAuthorizedPrincipalPolicySigner(
              tx,
              input,
              authorization.signerUserId,
            ),
        },
      );
      // Gate after authorization so an unauthorized signer still gets the
      // authorization error, not a billing error.
      await assertPrincipalOrganizationCanSync(
        tx,
        input.state.principalType,
        input.state.principalId,
      );
      const isExactReplay = previousState?.stateHash === nextState.stateHash;
      if (isExactReplay) {
        return getPrincipalPolicyForStateWithExecutor(tx, nextState);
      }
      await persistPrincipalPolicyAccessLossTombstones({
        currentState: nextState,
        executor: tx,
        previousState,
        updatedAt: new Date(),
      });
      const rosterSyncTarget = await syncRosterForStoredPrincipalState({
        request: input,
        tx,
      });
      if (rosterSyncTarget) {
        const isVisibleOrganizationGroupChange =
          input.expectedPrincipalType === "group" &&
          input.expectedPrincipalId !== rosterSyncTarget.memberGroupId;
        await reconcileOrganizationBillingSeats({
          executor: tx,
          organizationId: rosterSyncTarget.organizationId,
          source: {
            sourceId: nextState.stateHash,
            sourcePrincipalId: input.expectedPrincipalId,
            sourcePrincipalType: input.expectedPrincipalType,
            sourceType: "principal_state",
          },
        });
        if (
          rosterSyncTarget.changedRosterUserIds.length > 0 ||
          isVisibleOrganizationGroupChange
        ) {
          await appendOrganizationReadModelChangeInTransaction(tx, {
            organizationId: rosterSyncTarget.organizationId,
            lane: "directory",
            entityId: rosterSyncTarget.organizationId,
            operation: "replace",
          });
        }
        if (isVisibleOrganizationGroupChange) {
          await appendOrganizationReadModelChangeInTransaction(tx, {
            organizationId: rosterSyncTarget.organizationId,
            lane: "groups",
            entityId: input.expectedPrincipalId,
            operation: "upsert",
          });
        }
      }

      return getPrincipalPolicyForStateWithExecutor(tx, nextState);
    });
  } catch (error) {
    const principalPolicyError = toPrincipalPolicyError(error);
    if (principalPolicyError) {
      throw principalPolicyError;
    }

    throw error;
  }
}
