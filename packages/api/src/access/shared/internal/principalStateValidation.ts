import {
  computePrincipalMemberEnvelopesRoot,
  computePrincipalMembershipRoot,
  computePrincipalProjectionRoot,
  computePrincipalStatePayloadCiphertextHash,
  getPrincipalPolicyTransitionMismatchReason,
  type PrincipalProjectionMember,
  type SignedPrincipalState,
} from "@tearleads/crypto";
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

  const mismatchReason = getPrincipalPolicyTransitionMismatchReason({
    current: {
      state: input.currentState,
      projection: input.currentProjection,
    },
    previous: {
      state: input.previousState,
      projection: input.previousProjection,
    },
  });

  if (mismatchReason) {
    throw new Error(mismatchReason);
  }
}

export async function validatePrincipalStateArtifacts(
  input: PrincipalStateBundleInput,
): Promise<void> {
  const [
    computedProjectionRoot,
    computedMembershipRoot,
    computedEnvelopesRoot,
  ] = await Promise.all([
    computePrincipalProjectionRoot(input.projection),
    computePrincipalMembershipRoot(
      input.projection.map((member) => ({
        userId: member.userId,
      })),
    ),
    computePrincipalMemberEnvelopesRoot(input.memberEnvelopes),
  ]);
  if (computedProjectionRoot !== input.state.projectionRoot) {
    throw new Error("Principal state projectionRoot does not match projection");
  }

  if (computedMembershipRoot !== input.state.membershipRoot) {
    throw new Error("Principal state membershipRoot does not match projection");
  }

  if (computedEnvelopesRoot !== input.state.memberEnvelopesRoot) {
    throw new Error(
      "Principal state memberEnvelopesRoot does not match member envelopes",
    );
  }

  const computedPayloadCiphertextHash =
    await computePrincipalStatePayloadCiphertextHash(
      input.encryptedPayload.ciphertext,
    );
  if (computedPayloadCiphertextHash !== input.encryptedPayload.ciphertextHash) {
    throw new Error(
      "Principal state payload ciphertext hash does not match ciphertext",
    );
  }

  if (computedPayloadCiphertextHash !== input.state.payloadCiphertextHash) {
    throw new Error(
      "Principal state payloadCiphertextHash does not match encrypted payload",
    );
  }

  if (input.projection.length !== input.state.memberCount) {
    throw new Error("Principal state memberCount does not match projection");
  }
}
