import {
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
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === userId &&
      member.role === "admin",
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
  const computedProjectionRoot = await computePrincipalProjectionRoot(
    input.projection,
  );
  if (computedProjectionRoot !== input.state.projectionRoot) {
    throw new Error("Principal state projectionRoot does not match projection");
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
