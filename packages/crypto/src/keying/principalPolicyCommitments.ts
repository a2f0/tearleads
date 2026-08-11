import {
  computePrincipalContainerGrantRoot,
  normalizePrincipalContainerGrants,
} from "../principalContainerGrants";
import type {
  PrincipalContainerGrant,
  PrincipalProjectionMember,
  SignedPrincipalState,
} from "../principalState";
import {
  computePrincipalMembershipRoot,
  computePrincipalProjectionRoot,
} from "../principalState";
import { throwVerification } from "./shared";

export async function verifyPrincipalPolicyProjectionCommitments(input: {
  readonly projection: readonly PrincipalProjectionMember[];
  readonly state: SignedPrincipalState;
}): Promise<void> {
  const { projection, state } = input;
  const [computedProjectionRoot, computedMembershipRoot] = await Promise.all([
    computePrincipalProjectionRoot(projection),
    computePrincipalMembershipRoot(
      projection.map((member) => ({ userId: member.userId })),
    ),
  ]);

  if (computedProjectionRoot !== state.projectionRoot) {
    throwVerification(
      "hash_mismatch",
      "principal policy projection root does not match projection",
    );
  }

  if (computedMembershipRoot !== state.membershipRoot) {
    throwVerification(
      "hash_mismatch",
      "principal policy membership root does not match projection",
    );
  }

  if (projection.length !== state.memberCount) {
    throwVerification(
      "invalid_shape",
      "principal policy projection count does not match state member count",
    );
  }
}

export async function verifyPrincipalPolicyGrantCommitments(input: {
  readonly grants: readonly PrincipalContainerGrant[];
  readonly state: SignedPrincipalState;
}): Promise<PrincipalContainerGrant[]> {
  let normalized: PrincipalContainerGrant[];
  try {
    normalized = normalizePrincipalContainerGrants(input.grants);
  } catch (error) {
    throwVerification(
      "invalid_shape",
      error instanceof Error ? error.message : "principal grant set is invalid",
    );
  }
  if (
    (await computePrincipalContainerGrantRoot(normalized)) !==
    input.state.grantRoot
  ) {
    throwVerification(
      "hash_mismatch",
      "principal policy grant root does not match grant projection",
    );
  }
  if (normalized.length !== input.state.grantCount) {
    throwVerification(
      "invalid_shape",
      "principal policy grant count does not match grant projection",
    );
  }
  return normalized;
}
