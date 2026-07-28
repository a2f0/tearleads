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
  type StoredPrincipalState,
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
import { pruneRegainedAccessTombstones } from "../regainedAccessTombstones";
import { listPrincipalPolicyAccessGainNotificationUserIds } from "./accessGainNotifications";
import {
  candidateContainerIdsForPrincipalState,
  persistPrincipalPolicyAccessLossTombstones,
} from "./accessLossTombstones";
import { getPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import { assertPrincipalOrganizationCanSync } from "./organizationSync";
import { lockPrincipalMutationInTransaction } from "./principalMutationLock";
import {
  assertPolicyAuthorityConstraints,
  type OrganizationPolicyTarget,
} from "./principalPolicyAuthorityConstraints";
import { assertPrincipalPolicyGroupReferencesExist } from "./principalPolicyGroupReferences";
import { listUserIdsReachableFromPrincipalState } from "./principalStateReachability";
import { PrincipalPolicyError, toPrincipalPolicyError } from "./shared";
import { storeVerifiedPrincipalPolicyInTransaction } from "./storeVerifiedPrincipalPolicy";

export interface PutPrincipalPolicyInput extends PutPrincipalPolicyRequest {
  expectedPrincipalId: string;
  expectedPrincipalType: "group" | "organization";
  requesterUserId: string;
}

export interface PutPrincipalPolicyResult {
  readonly policy: PrincipalPolicyBundleResponse;
  readonly sharedWithYouUserIds: readonly string[];
}

interface RosterSyncResult {
  readonly changedRosterUserIds: string[];
  readonly memberGroupId: string;
  readonly organizationId: string;
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
}): Promise<RosterSyncResult | null> {
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

async function appendPolicyReadModelChanges(input: {
  readonly policy: PutPrincipalPolicyInput;
  readonly rosterSync: RosterSyncResult;
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  const isOrganizationGroupChange =
    input.policy.expectedPrincipalType === "group";
  const isVisibleOrganizationGroupChange =
    isOrganizationGroupChange &&
    input.policy.expectedPrincipalId !== input.rosterSync.memberGroupId;
  if (input.rosterSync.changedRosterUserIds.length > 0) {
    await appendOrganizationReadModelChangeInTransaction(input.tx, {
      organizationId: input.rosterSync.organizationId,
      lane: "directory",
      entityId: input.rosterSync.organizationId,
      operation: "replace",
    });
  }
  if (input.policy.expectedPrincipalType === "organization") {
    await appendOrganizationReadModelChangeInTransaction(input.tx, {
      organizationId: input.rosterSync.organizationId,
      lane: "organizationPolicy",
      entityId: input.rosterSync.organizationId,
      operation: "replace",
    });
  }
  if (isVisibleOrganizationGroupChange) {
    await appendOrganizationReadModelChangeInTransaction(input.tx, {
      organizationId: input.rosterSync.organizationId,
      lane: "groups",
      entityId: input.policy.expectedPrincipalId,
      operation: "upsert",
    });
  }
  if (isOrganizationGroupChange) {
    await appendOrganizationReadModelChangeInTransaction(input.tx, {
      organizationId: input.rosterSync.organizationId,
      lane: "groupMemberships",
      entityId: input.policy.expectedPrincipalId,
      operation: "replace",
    });
  }
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

async function applyPrincipalPolicyTransitionEffects(input: {
  readonly currentReachableUserIds: readonly string[];
  readonly nextState: StoredPrincipalState;
  readonly policy: PutPrincipalPolicyInput;
  readonly previousReachableUserIds: readonly string[];
  readonly previousState: StoredPrincipalState | null;
  readonly tx: DatabaseTransaction;
}): Promise<string[]> {
  await persistPrincipalPolicyAccessLossTombstones({
    currentReachableUserIds: input.currentReachableUserIds,
    currentState: input.nextState,
    executor: input.tx,
    previousReachableUserIds: input.previousReachableUserIds,
    previousState: input.previousState,
    updatedAt: new Date(),
  });
  // The mirror image: users this transition can now reach may hold stale
  // access_revoked tombstones from an earlier loss; prune the ones their
  // regained access has invalidated so their next lane pull relists the
  // containers (the container timestamp does not advance on a policy-only
  // restore, so the stale row would otherwise win forever). Scoped to the
  // containers this principal's grants can actually restore — an ungranted
  // group prunes nothing.
  const previousReachable = new Set(input.previousReachableUserIds);
  const addedUserIds = input.currentReachableUserIds.filter(
    (userId) => !previousReachable.has(userId),
  );
  if (addedUserIds.length > 0) {
    // Grants inherit through container paths; the prune selects the gained
    // users' tombstones first and intersects them with these grant roots'
    // subtrees, so a root-level grant never materializes its whole subtree.
    await pruneRegainedAccessTombstones({
      executor: input.tx,
      userIds: addedUserIds,
      withinSubtreesOf: await candidateContainerIdsForPrincipalState({
        currentState: input.nextState,
        executor: input.tx,
      }),
    });
  }
  const rosterSyncTarget = await syncRosterForStoredPrincipalState({
    request: input.policy,
    tx: input.tx,
  });
  if (rosterSyncTarget) {
    await reconcileOrganizationBillingSeats({
      executor: input.tx,
      organizationId: rosterSyncTarget.organizationId,
      source: {
        sourceId: input.nextState.stateHash,
        sourcePrincipalId: input.policy.expectedPrincipalId,
        sourcePrincipalType: input.policy.expectedPrincipalType,
        sourceType: "principal_state",
      },
    });
    await appendPolicyReadModelChanges({
      policy: input.policy,
      rosterSync: rosterSyncTarget,
      tx: input.tx,
    });
  }

  return listPrincipalPolicyAccessGainNotificationUserIds({
    currentReachableUserIds: input.currentReachableUserIds,
    executor: input.tx,
    previousReachableUserIds: input.previousReachableUserIds,
    principalId: input.policy.expectedPrincipalId,
    principalType: input.policy.expectedPrincipalType,
  });
}

export async function runPutPrincipalPolicyWorkflow(
  db: ApiDatabase,
  input: PutPrincipalPolicyInput,
): Promise<PutPrincipalPolicyResult> {
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
      const previousReachableUserIds = previousState
        ? await listUserIdsReachableFromPrincipalState({
            executor: tx,
            state: previousState,
          })
        : [];
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
        return {
          policy: await getPrincipalPolicyForStateWithExecutor(tx, nextState),
          sharedWithYouUserIds: [],
        };
      }
      const currentReachableUserIds =
        await listUserIdsReachableFromPrincipalState({
          executor: tx,
          state: nextState,
        });
      const sharedWithYouUserIds = await applyPrincipalPolicyTransitionEffects({
        currentReachableUserIds,
        nextState,
        policy: input,
        previousReachableUserIds,
        previousState,
        tx,
      });
      return {
        policy: await getPrincipalPolicyForStateWithExecutor(tx, nextState),
        sharedWithYouUserIds,
      };
    });
  } catch (error) {
    const principalPolicyError = toPrincipalPolicyError(error);
    if (principalPolicyError) {
      throw principalPolicyError;
    }

    throw error;
  }
}
