import {
  computePrincipalContainerGrantRoot,
  computePrincipalMemberEnvelopesRoot,
  computePrincipalMembershipRoot,
  computePrincipalProjectionRoot,
  computePrincipalStatePayloadCiphertextHash,
  getPrincipalPolicyTransitionMismatch,
  type PrincipalProjectionMember,
  type SignedPrincipalState,
  throwPrincipalPolicyValidationError,
} from "@symcrypt/crypto";
import type {
  PrincipalStateBundleInput,
  StoredPrincipalProjectionMember,
  StoredPrincipalState,
} from "./principalStateRecords";

export function projectionIncludesAdminUser(
  projection: ReadonlyArray<PrincipalProjectionMember>,
  userId: string,
): boolean {
  return projection.some(
    (member) => member.userId === userId && member.role === "admin",
  );
}

export function validatePrincipalPolicyTransition(input: {
  currentState: SignedPrincipalState;
  currentProjection: readonly PrincipalProjectionMember[];
  previousProjection: readonly StoredPrincipalProjectionMember[] | null;
  previousState: StoredPrincipalState | null;
}): void {
  if (!input.previousState || !input.previousProjection) {
    return;
  }

  const mismatch = getPrincipalPolicyTransitionMismatch({
    current: {
      state: input.currentState,
      projection: input.currentProjection,
    },
    previous: {
      state: input.previousState,
      projection: input.previousProjection,
    },
  });

  if (mismatch) {
    throwPrincipalPolicyValidationError("state_conflict", mismatch.message);
  }
}

export async function validatePrincipalStateArtifacts(
  input: PrincipalStateBundleInput,
): Promise<void> {
  const [
    computedProjectionRoot,
    computedMembershipRoot,
    computedEnvelopesRoot,
    computedGrantRoot,
  ] = await Promise.all([
    computePrincipalProjectionRoot(input.projection),
    computePrincipalMembershipRoot(
      input.projection.map((member) => ({
        userId: member.userId,
      })),
    ),
    computePrincipalMemberEnvelopesRoot(input.memberEnvelopes),
    computePrincipalContainerGrantRoot(input.grants),
  ]);
  if (computedProjectionRoot !== input.state.projectionRoot) {
    throwPrincipalPolicyValidationError(
      "invalid_artifact",
      "Principal state projectionRoot does not match projection",
    );
  }

  if (computedMembershipRoot !== input.state.membershipRoot) {
    throwPrincipalPolicyValidationError(
      "invalid_artifact",
      "Principal state membershipRoot does not match projection",
    );
  }

  if (computedEnvelopesRoot !== input.state.memberEnvelopesRoot) {
    throwPrincipalPolicyValidationError(
      "invalid_artifact",
      "Principal state memberEnvelopesRoot does not match member envelopes",
    );
  }

  if (computedGrantRoot !== input.state.grantRoot) {
    throwPrincipalPolicyValidationError(
      "invalid_artifact",
      "Principal state grantRoot does not match grant projection",
    );
  }

  const computedPayloadCiphertextHash =
    await computePrincipalStatePayloadCiphertextHash(
      input.encryptedPayload.ciphertext,
    );
  if (computedPayloadCiphertextHash !== input.encryptedPayload.ciphertextHash) {
    throwPrincipalPolicyValidationError(
      "invalid_artifact",
      "Principal state payload ciphertext hash does not match ciphertext",
    );
  }

  if (computedPayloadCiphertextHash !== input.state.payloadCiphertextHash) {
    throwPrincipalPolicyValidationError(
      "invalid_artifact",
      "Principal state payloadCiphertextHash does not match encrypted payload",
    );
  }

  if (input.projection.length !== input.state.memberCount) {
    throwPrincipalPolicyValidationError(
      "invalid_artifact",
      "Principal state memberCount does not match projection",
    );
  }
  if (input.grants.length !== input.state.grantCount) {
    throwPrincipalPolicyValidationError(
      "invalid_artifact",
      "Principal state grantCount does not match grant projection",
    );
  }
}
