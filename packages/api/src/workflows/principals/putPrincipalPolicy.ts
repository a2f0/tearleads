import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  getCurrentPrincipalState,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { reconcileOrganizationBillingSeats } from "../billing/organizationSeats";
import { toMutationError } from "../containers/mutations/errors";
import { OrganizationManagerError } from "../organizations/errors";
import { appendOrganizationReadModelChangeInTransaction } from "../organizations/readModelChanges";
import { syncOrganizationRosterFromMemberReachability } from "../organizations/roster";
import { pruneRegainedAccessTombstones } from "../regainedAccessTombstones";
import { listPrincipalPolicyAccessGainNotificationUserIds } from "./accessGainNotifications";
import {
  candidateContainerIdsForPrincipalState,
  persistPrincipalPolicyAccessLossTombstones,
} from "./accessLossTombstones";
import { getPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import {
  lockGroupPolicyRematerializationInTransaction,
  lockGroupReferenceExclusiveInTransaction,
} from "./groupReferenceLock";
import {
  assertManagedPrincipalRosterMembership,
  assertOrganizationAdminsRosterMembership,
} from "./managedPrincipalRosterMembership";
import { assertPrincipalOrganizationIsSyncEntitled } from "./organizationSync";
import { applyPrincipalContainerRematerializations } from "./principalContainerRematerialization";
import { lockPrincipalMutationInTransaction } from "./principalMutationLock";
import { assertPolicyAuthorityConstraints } from "./principalPolicyAuthorityConstraints";
import {
  isOrgAdminAuthorizedPrincipalPolicySigner,
  loadRosterSyncTargetForPrincipal,
  lockOrganizationReadModelForPolicyMutation,
  type PutPrincipalPolicyInput,
} from "./principalPolicyMutationAuthorization";
import { listUserIdsReachableFromPrincipalState } from "./principalStateReachability";
import { PrincipalPolicyError, toPrincipalPolicyError } from "./shared";
import { storeVerifiedPrincipalPolicyInTransaction } from "./storeVerifiedPrincipalPolicy";

export type { PutPrincipalPolicyInput } from "./principalPolicyMutationAuthorization";

export interface PutPrincipalPolicyResult {
  readonly policy: PrincipalPolicyBundleResponse;
  readonly sharedWithYouUserIds: readonly string[];
}

interface RosterSyncResult {
  readonly changedRosterUserIds: string[];
  readonly memberGroupId: string;
  readonly organizationId: string;
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

  const { changedUserIds: changedRosterUserIds } =
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
    await assertManagedPrincipalRosterMembership({
      organizationId: rosterSyncTarget.organizationId,
      principalId: input.request.expectedPrincipalId,
      principalType: input.request.expectedPrincipalType,
      tx: input.tx,
    });
  } else {
    // A Members write just moved the roster underneath every other group.
    // Admins is the one that must not be left holding an off-roster user.
    await assertOrganizationAdminsRosterMembership({
      organizationId: rosterSyncTarget.organizationId,
      tx: input.tx,
    });
  }
  return {
    ...rosterSyncTarget,
    changedRosterUserIds,
  };
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

async function putPrincipalPolicyInTransaction(
  tx: DatabaseTransaction,
  input: PutPrincipalPolicyInput,
): Promise<PutPrincipalPolicyResult> {
  await lockPolicyPrincipalMutation(tx, input);
  const policyTarget = await lockOrganizationReadModelForPolicyMutation(
    tx,
    input,
  );
  if (!policyTarget) {
    throw new PrincipalPolicyError("Principal policy target not found", 404);
  }
  await assertPolicyAuthorityConstraints(tx, input);
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
  await assertPrincipalOrganizationIsSyncEntitled(
    tx,
    input.state.principalType,
    input.state.principalId,
  );
  const applyRematerializations = () =>
    applyPrincipalContainerRematerializations({
      executor: tx,
      fingerprint: input.state.signerUserKeyFingerprint,
      isExactReplay: previousState?.stateHash === nextState.stateHash,
      nextHead: {
        principalType: nextState.principalType,
        principalId: nextState.principalId,
        version: nextState.version,
        keyEpoch: nextState.keyEpoch,
        stateHash: nextState.stateHash,
        keyFingerprint: nextState.keyFingerprint,
      },
      previousKeyEpoch: previousState?.keyEpoch ?? null,
      requests: input.containerMutations,
      userId: input.requesterUserId,
    });
  if (previousState?.stateHash === nextState.stateHash) {
    await applyRematerializations();
    return {
      policy: await getPrincipalPolicyForStateWithExecutor(tx, nextState),
      sharedWithYouUserIds: [],
    };
  }
  const currentReachableUserIds = await listUserIdsReachableFromPrincipalState({
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
  await applyRematerializations();
  return {
    policy: await getPrincipalPolicyForStateWithExecutor(tx, nextState),
    sharedWithYouUserIds,
  };
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
  if (input.expectedPrincipalType === "group") {
    // Two group successors may each rematerialize a container that references
    // the other group. Serialize these compound transitions before either one
    // takes its own exclusive reference lock, avoiding a shared-lock cycle.
    await lockGroupPolicyRematerializationInTransaction(tx);
    // Container grants take the corresponding shared lock. Holding it
    // exclusively makes the dependent-grant set stable until the policy and
    // every required rematerialization commit together.
    await lockGroupReferenceExclusiveInTransaction(
      tx,
      input.expectedPrincipalId,
    );
  }
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
  // Prune stale access_revoked tombstones for newly reachable users. Scope the
  // repair to granted subtrees; an ungranted group prunes nothing.
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
    return await db.transaction((tx) =>
      putPrincipalPolicyInTransaction(tx, input),
    );
  } catch (error) {
    const containerMutationError = toMutationError(error);
    if (containerMutationError) {
      throw new PrincipalPolicyError(
        containerMutationError.message,
        containerMutationError.status,
      );
    }
    if (error instanceof OrganizationManagerError) {
      throw new PrincipalPolicyError(error.message, error.status, error.code);
    }
    const principalPolicyError = toPrincipalPolicyError(error);
    if (principalPolicyError) {
      throw principalPolicyError;
    }

    throw error;
  }
}
