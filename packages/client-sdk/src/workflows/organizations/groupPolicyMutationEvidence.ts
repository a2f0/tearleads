import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyExternalAuthority,
  type PrincipalPolicySignerPublicKey,
  type SigningKeyPair,
  type VerifiedPrincipalPolicyCurrent,
  verifyPrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { assertCurrentMatchesVerifiedPolicy } from "../../data/persistence/verifiedPrincipalPolicyCurrent";
import { requireSignerCanManageGroup } from "./groupMutationAuthorization";
import { verifyGroupPolicy } from "./groupPolicyVerification";

interface GroupMembershipSigningInput {
  readonly currentOrgAdminUserIds?: readonly string[] | undefined;
  readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
  readonly isOrganizationAdminsGroup?: boolean | undefined;
  readonly localPolicyCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}

export interface FullGroupMembershipMutationInput
  extends GroupMembershipSigningInput {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly currentPolicySignerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}

interface CurrentGroupMembershipMutationInput
  extends GroupMembershipSigningInput {
  readonly currentPolicy: PrincipalPolicyPageCurrent;
  readonly verifiedCurrentPolicy: VerifiedPrincipalPolicyCurrent;
  readonly stillCurrent: () => boolean;
}

export type BuildGroupMembershipMutationInput =
  | FullGroupMembershipMutationInput
  | CurrentGroupMembershipMutationInput;

/** Current artifacts require their verified evidence; omitted history is never a bundle. */
export async function withVerifiedGroupMutation<T>(
  input: BuildGroupMembershipMutationInput,
  work: () => Promise<T>,
): Promise<T> {
  const current = () =>
    !("verifiedCurrentPolicy" in input) || input.stillCurrent();
  assertProjectionVerificationCurrent(current);
  if ("verifiedCurrentPolicy" in input) {
    await assertCurrentMatchesVerifiedPolicy({
      current: input.currentPolicy,
      policy: input.verifiedCurrentPolicy,
    });
    verifyPrincipalPolicyCheckpoint({
      chain: input.verifiedCurrentPolicy.retainedHistory,
      currentState: input.verifiedCurrentPolicy.state,
      localCheckpoint: input.localPolicyCheckpoint,
    });
  } else {
    await verifyGroupPolicy({
      currentPolicy: input.currentPolicy,
      ...(input.externalAuthority
        ? { externalAuthority: input.externalAuthority }
        : {}),
      localPolicyCheckpoint: input.localPolicyCheckpoint ?? null,
      signerPublicKeys: input.currentPolicySignerPublicKeys,
    });
  }
  assertProjectionVerificationCurrent(current);
  requireSignerCanManageGroup(
    input.currentPolicy,
    input.currentOrgAdminUserIds ?? [],
    input.signerUserId,
  );
  const result = await work();
  assertProjectionVerificationCurrent(current);
  return result;
}
