import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { groups, organizations } from "@tearleads/api-shared/schema";
import type { PutPrincipalMemberEnvelopesRequest } from "@tearleads/validators/request";
import type { CurrentPrincipalMemberEnvelopesResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../access/write/principalMemberEnvelopes";
import { isUserReachableThroughCurrentGroup } from "../organizations/access";
import { assertPrincipalOrganizationCanSync } from "./organizationSync";
import {
  PrincipalPolicyError,
  toCurrentPrincipalMemberEnvelopesResponse,
  toPrincipalMemberEnvelopeError,
} from "./shared";

export type PutPrincipalMemberEnvelopesInput =
  PutPrincipalMemberEnvelopesRequest & {
    principalType: "group" | "organization";
    principalId: string;
    /**
     * Authenticated caller. Must be authorized to write this principal's policy
     * (a member, or an org admin who manages it) — see
     * {@link assertRequesterMayWritePrincipalEnvelopes}.
     */
    requesterUserId: string;
  };

/**
 * Resolve the admin group whose members may administer `principalId`. For an
 * organization principal that is its own admin group; for a group principal it
 * is the owning organization's admin group. Mirrors the resolution in
 * `putPrincipalState`'s `isOrgAdminAuthorizedPrincipalPolicySigner`.
 */
async function resolveAdministeringAdminGroupId(
  input: PutPrincipalMemberEnvelopesInput,
  tx: DatabaseTransaction,
): Promise<string | null> {
  if (input.principalType === "organization") {
    const [organization] = await tx
      .select({ adminGroupId: organizations.adminGroupId })
      .from(organizations)
      .where(eq(organizations.id, input.principalId))
      .limit(1);
    return organization?.adminGroupId ?? null;
  }

  const [group] = await tx
    .select({ adminGroupId: organizations.adminGroupId })
    .from(groups)
    .innerJoin(organizations, eq(organizations.id, groups.organizationId))
    .where(eq(groups.id, input.principalId))
    .limit(1);
  return group?.adminGroupId ?? null;
}

/**
 * Member envelopes wrap the principal's epoch key for each direct member. The
 * write below unconditionally replaces every existing envelope, the envelopes
 * are unsigned, and the wrapped key material is opaque to the server — so
 * without an authorization gate any authenticated user could read the public
 * policy bundle (stateHash + member set + fingerprints) and overwrite a
 * principal's envelopes with garbage, locking its members out of decryption.
 *
 * Because the envelopes carry no signer, we authorize the caller exactly like
 * the signed `putPrincipalState` write this envelope write is always paired
 * with (see `commitGroupPolicyMutation` in the client SDK): the caller must be
 * a direct/reachable member of the principal, OR an admin of the organization
 * that administers it (org admins legitimately manage org-scoped group policy —
 * the same allowance `putPrincipalState` grants via
 * `isOrgAdminAuthorizedPrincipalPolicySigner`). Reachability is evaluated
 * against the current state inside the same transaction as the write.
 */
async function assertRequesterMayWritePrincipalEnvelopes(
  input: PutPrincipalMemberEnvelopesInput,
  tx: DatabaseTransaction,
): Promise<void> {
  // A Set so that an id appearing in more than one role (e.g. the principal is
  // itself the administering admin group) is probed only once below.
  const authorizingGroupIds = new Set<string>();
  if (input.principalType === "group") {
    authorizingGroupIds.add(input.principalId);
  } else {
    const [organization] = await tx
      .select({
        adminGroupId: organizations.adminGroupId,
        memberGroupId: organizations.memberGroupId,
      })
      .from(organizations)
      .where(eq(organizations.id, input.principalId))
      .limit(1);
    if (!organization) {
      throw new PrincipalPolicyError("Principal state not found", 404);
    }
    authorizingGroupIds.add(organization.memberGroupId);
    authorizingGroupIds.add(organization.adminGroupId);
  }

  const administeringAdminGroupId = await resolveAdministeringAdminGroupId(
    input,
    tx,
  );
  if (administeringAdminGroupId) {
    authorizingGroupIds.add(administeringAdminGroupId);
  }

  for (const groupId of authorizingGroupIds) {
    if (
      await isUserReachableThroughCurrentGroup({
        executor: tx,
        groupId,
        userId: input.requesterUserId,
      })
    ) {
      return;
    }
  }

  throw new PrincipalPolicyError(
    "Principal member envelope writer is not authorized for this principal",
    403,
  );
}

/**
 * Stores the current member key envelopes for a principal's active state and
 * returns them in the current-state response shape.
 */
export async function runPutPrincipalMemberEnvelopesWorkflow(
  db: ApiDatabase,
  input: PutPrincipalMemberEnvelopesInput,
): Promise<CurrentPrincipalMemberEnvelopesResponse> {
  return db.transaction(async (tx) => {
    const currentState = await getCurrentPrincipalState(
      input.principalType,
      input.principalId,
      tx,
    );

    if (!currentState) {
      throw new PrincipalPolicyError("Principal state not found", 404);
    }

    // Authorize the caller BEFORE touching envelope rows: the write below
    // unconditionally replaces every existing envelope, so an unauthorized
    // caller reaching it would already be able to destroy key material.
    await assertRequesterMayWritePrincipalEnvelopes(input, tx);
    await assertPrincipalOrganizationCanSync(
      tx,
      input.principalType,
      input.principalId,
    );

    try {
      const storedEnvelopes =
        await replaceCurrentPrincipalMemberEnvelopesInTransaction(
          {
            principalType: input.principalType,
            principalId: input.principalId,
            stateHash: input.stateHash,
            envelopes: input.envelopes.map((envelope) => ({
              memberPrincipalType: envelope.memberPrincipalType,
              memberPrincipalId: envelope.memberPrincipalId,
              memberKeyFingerprint: envelope.memberKeyFingerprint,
              kemCipherText: envelope.kemCipherText,
              wrappedKey: envelope.wrappedKey,
            })),
          },
          tx,
        );

      return toCurrentPrincipalMemberEnvelopesResponse({
        principalType: input.principalType,
        principalId: input.principalId,
        // Report the validated/written hash. The replace above enforces
        // input.stateHash === currentState.stateHash (throwing "must target
        // the current state" otherwise), so this matches what was persisted.
        stateHash: input.stateHash,
        epoch: currentState.keyEpoch,
        envelopes: storedEnvelopes,
      });
    } catch (error) {
      const principalPolicyError = toPrincipalMemberEnvelopeError(error);
      if (principalPolicyError) {
        throw principalPolicyError;
      }

      throw error;
    }
  });
}
