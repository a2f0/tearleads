import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import type { PutPrincipalStateRequest } from "@tearleads/validators/request";
import type { PrincipalStateResponse } from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import type { PrincipalStateExternalSignerAuthorizationInput } from "../../access/write/principalStateStore";
import { storeVerifiedPrincipalStateInTransaction } from "../../access/write/principalStateStore";
import { isUserReachableThroughCurrentGroup } from "../organizations/access";
import { listUsersReachableFromCurrentPrincipal } from "../organizations/principalReachability";
import { syncOrganizationRosterFromMemberReachability } from "../organizations/roster";
import { persistPrincipalPolicyAccessLossTombstones } from "./accessLossTombstones";
import { PrincipalPolicyError, toPrincipalStateResponse } from "./shared";

export interface PutPrincipalStateInput extends PutPrincipalStateRequest {
  expectedPrincipalId: string;
  expectedPrincipalType: "group" | "organization";
}

export function toPrincipalStateError(
  error: unknown,
): PrincipalPolicyError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (error.message === "Invalid principal state signature") {
    return new PrincipalPolicyError(error.message, 403);
  }

  if (
    error.message === "Principal state signer user not found" ||
    error.message === "Principal state signer fingerprint mismatch" ||
    error.message === "Principal state signer must be an admin"
  ) {
    return new PrincipalPolicyError(error.message, 403);
  }

  if (
    error.message === "Principal state version conflict" ||
    error.message === "Principal epoch key conflict" ||
    error.message === "Principal state previous hash mismatch" ||
    error.message === "Principal state payload conflict" ||
    error.message === "Principal state projection conflict" ||
    error.message === "Principal policy transition principal mismatch" ||
    error.message === "Principal policy transition version is not contiguous" ||
    error.message === "Principal policy transition previous hash mismatch" ||
    error.message === "Principal policy key epoch cannot decrease" ||
    error.message === "Principal policy key change requires a new key epoch" ||
    error.message ===
      "Principal policy key epoch advance requires new key material" ||
    error.message ===
      "Principal policy shrink requires a new key epoch and key material"
  ) {
    return new PrincipalPolicyError(error.message, 409);
  }

  if (
    error.message ===
      "Principal state payload ciphertext hash does not match ciphertext" ||
    error.message ===
      "Principal state payloadCiphertextHash does not match encrypted payload" ||
    error.message ===
      "Principal state projectionRoot does not match projection" ||
    error.message === "Principal state memberCount does not match projection"
  ) {
    return new PrincipalPolicyError(error.message, 400);
  }

  return null;
}

async function isOrgAdminAuthorizedPrincipalPolicySigner(
  tx: DatabaseTransaction,
  input: PutPrincipalStateInput,
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
  readonly input: PutPrincipalStateInput;
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
  readonly request: PutPrincipalStateInput;
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  const rosterSyncTarget = await loadRosterSyncTargetForPrincipal({
    input: input.request,
    tx: input.tx,
  });
  if (!rosterSyncTarget) {
    return;
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
}

export async function runPutPrincipalStateWorkflow(
  db: ApiDatabase,
  input: PutPrincipalStateInput,
): Promise<PrincipalStateResponse> {
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

  try {
    const storedState = await db.transaction(async (tx) => {
      const previousState = await getCurrentPrincipalState(
        input.state.principalType,
        input.state.principalId,
        tx,
      );
      const nextState = await storeVerifiedPrincipalStateInTransaction(
        {
          state: {
            principalType: input.state.principalType,
            principalId: input.state.principalId,
            version: input.state.version,
            prevStateHash: input.state.prevStateHash,
            keyEpoch: input.state.keyEpoch,
            encapsulationPublicKey: input.state.encapsulationPublicKey,
            keyFingerprint: input.state.keyFingerprint,
            membershipMode: input.state.membershipMode,
            membershipRoot: input.state.membershipRoot,
            projectionRoot: input.state.projectionRoot,
            payloadCiphertextHash: input.state.payloadCiphertextHash,
            memberCount: input.state.memberCount,
            signedAt: input.state.signedAt,
            signerUserId: input.state.signerUserId,
            signerUserKeyFingerprint: input.state.signerUserKeyFingerprint,
            signature: input.state.signature,
          },
          encryptedPayload: {
            cipherSuite: input.encryptedPayload.cipherSuite,
            ciphertext: input.encryptedPayload.ciphertext,
            ciphertextHash: input.encryptedPayload.ciphertextHash,
          },
          projection: input.projection.map((member) => ({
            memberPrincipalType: member.memberPrincipalType,
            memberPrincipalId: member.memberPrincipalId,
            role: member.role,
          })),
        },
        tx,
        {
          authorizeExternalAdminSigner: (authorization) =>
            isOrgAdminAuthorizedPrincipalPolicySigner(tx, input, authorization),
        },
      );
      await persistPrincipalPolicyAccessLossTombstones({
        currentState: nextState,
        executor: tx,
        previousState,
        updatedAt: new Date(),
      });
      await syncRosterForStoredPrincipalState({ request: input, tx });

      return nextState;
    });

    return toPrincipalStateResponse(storedState);
  } catch (error) {
    const principalPolicyError = toPrincipalStateError(error);
    if (principalPolicyError) {
      throw principalPolicyError;
    }

    throw error;
  }
}
