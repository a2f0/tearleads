import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import type { PrincipalStateExternalSignerAuthorizationInput } from "../../access/write/principalStateStore";
import { reconcileOrganizationBillingSeats } from "../billing/organizationSeats";
import { isUserReachableThroughCurrentGroup } from "../organizations/access";
import { listUsersReachableFromCurrentPrincipal } from "../organizations/principalReachability";
import { syncOrganizationRosterFromMemberReachability } from "../organizations/roster";
import { persistPrincipalPolicyAccessLossTombstones } from "./accessLossTombstones";
import { getPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import { assertPrincipalOrganizationCanSync } from "./organizationSync";
import { PrincipalPolicyError, toPrincipalPolicyError } from "./shared";
import { storeVerifiedPrincipalPolicyInTransaction } from "./storeVerifiedPrincipalPolicy";

export interface PutPrincipalPolicyInput extends PutPrincipalPolicyRequest {
  expectedPrincipalId: string;
  expectedPrincipalType: "group" | "organization";
  requesterUserId: string;
}

async function isOrgAdminAuthorizedPrincipalPolicySigner(
  tx: DatabaseTransaction,
  input: PutPrincipalPolicyInput,
  authorization: PrincipalStateExternalSignerAuthorizationInput,
): Promise<boolean> {
  if (input.expectedPrincipalType === "organization") {
    const [organization] = await tx
      .select({ adminGroupId: organizations.adminGroupId })
      .from(organizations)
      .where(eq(organizations.id, input.expectedPrincipalId))
      .limit(1);

    return organization
      ? isUserReachableThroughCurrentGroup({
          executor: tx,
          groupId: organization.adminGroupId,
          userId: authorization.signerUserId,
        })
      : false;
  }

  const [group] = await tx
    .select({
      adminGroupId: organizations.adminGroupId,
    })
    .from(groups)
    .innerJoin(organizations, eq(organizations.id, groups.organizationId))
    .where(eq(groups.id, input.expectedPrincipalId))
    .limit(1);

  if (!group) {
    return false;
  }

  return isUserReachableThroughCurrentGroup({
    executor: tx,
    groupId: group.adminGroupId,
    userId: authorization.signerUserId,
  });
}

async function loadRosterSyncTargetForPrincipal(input: {
  readonly input: PutPrincipalPolicyInput;
  readonly tx: DatabaseTransaction;
}): Promise<{ organizationId: string; memberGroupId: string } | null> {
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
}): Promise<{ organizationId: string; memberGroupId: string } | null> {
  const rosterSyncTarget = await loadRosterSyncTargetForPrincipal({
    input: input.request,
    tx: input.tx,
  });
  if (!rosterSyncTarget) {
    return null;
  }

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
  return rosterSyncTarget;
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
}

export async function runPutPrincipalPolicyWorkflow(
  db: ApiDatabase,
  input: PutPrincipalPolicyInput,
): Promise<PrincipalPolicyBundleResponse> {
  assertPutPrincipalPolicyRouteBinding(input);

  try {
    return await db.transaction(async (tx) => {
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
            isOrgAdminAuthorizedPrincipalPolicySigner(tx, input, authorization),
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
