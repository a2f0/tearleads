import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyExternalAuthority,
  type PrincipalPolicySignerPublicKey,
  type SigningKeyPair,
  type VerifiedPrincipalPolicyCurrent,
  verifyPrincipalPolicyCheckpoint,
  verifyPrincipalPolicyCurrentMutation,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
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
export async function withVerifiedGroupMutation<
  T extends BuildGroupMembershipMutationInput,
>(
  input: T,
  work: (owned: T) => Promise<PutPrincipalPolicyRequest>,
): Promise<PutPrincipalPolicyRequest> {
  input = {
    ...input,
    currentPolicy: structuredClone(input.currentPolicy),
    ...("currentPolicySignerPublicKeys" in input
      ? {
          currentPolicySignerPublicKeys: structuredClone(
            input.currentPolicySignerPublicKeys,
          ),
        }
      : {}),
    currentOrgAdminUserIds: structuredClone(input.currentOrgAdminUserIds),
    externalAuthority: structuredClone(input.externalAuthority),
    localPolicyCheckpoint: structuredClone(input.localPolicyCheckpoint),
    signingKeyPair: structuredClone(input.signingKeyPair),
  };
  const current = () =>
    !("verifiedCurrentPolicy" in input) || input.stillCurrent();
  assertProjectionVerificationCurrent(current);
  if ("verifiedCurrentPolicy" in input) {
    await assertCurrentMatchesVerifiedPolicy({
      current: input.currentPolicy,
      policy: input.verifiedCurrentPolicy,
    });
    requireSignerCanManageGroup(
      input.currentPolicy,
      input.currentOrgAdminUserIds ?? [],
      input.signerUserId,
    );
    const verified = await verifyPrincipalPolicyCurrentMutation({
      current: input.currentPolicy,
      policy: input.verifiedCurrentPolicy,
      signerUserId: input.signerUserId,
      externalAuthority: input.externalAuthority,
    });
    if (!verified.ok) throw verified.error;
    verifyPrincipalPolicyCheckpoint({
      chain: verified.value.retainedHistory,
      currentState: verified.value.state,
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
  const result = await work(input);
  assertProjectionVerificationCurrent(current);
  return result;
}
