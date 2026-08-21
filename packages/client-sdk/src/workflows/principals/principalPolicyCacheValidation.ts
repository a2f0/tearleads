import {
  type KeyingVerificationCode,
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  type VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type {
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@symcrypt/validators/response";
import { verifyPrincipalPolicyBundleWithExternalOrganizationAdmins } from "../../data/principals/principalPolicyAdminSigners";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import type { VerifiedExternalAdminPolicy } from "./externalAdminPolicy";
import {
  collectPrincipalPolicySignerPublicKeys,
  type PrincipalPolicySignerPublicKeyLoadErrorCode,
  principalPolicyStates,
} from "./policyVerification";

interface PrincipalPolicyValidationFailure {
  readonly code: KeyingVerificationCode;
  readonly message: string;
}

function getBundleReferenceFailure(
  reference: ReferencedPrincipalStateResponse,
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyValidationFailure | null {
  const states = principalPolicyStates(bundle);
  const hasReferencedPrincipal = states.some(
    (state) =>
      state.principalType === reference.principalType &&
      state.principalId === reference.principalId,
  );
  if (!hasReferencedPrincipal) {
    return {
      code: "object_mismatch",
      message: "bundle principal does not match referenced principal",
    };
  }
  if (
    !states.some(
      (state) =>
        state.principalType === reference.principalType &&
        state.principalId === reference.principalId &&
        state.version === reference.version &&
        state.keyEpoch === reference.keyEpoch &&
        state.stateHash === reference.stateHash &&
        state.keyFingerprint === reference.keyFingerprint,
    )
  ) {
    return {
      code: "hash_mismatch",
      message: "bundle chain does not contain referenced principal",
    };
  }
  if (
    bundle.currentMemberEnvelopes.principalType !==
      bundle.currentState.principalType ||
    bundle.currentMemberEnvelopes.principalId !==
      bundle.currentState.principalId
  ) {
    return {
      code: "object_mismatch",
      message: "member envelope principal does not match current principal",
    };
  }
  if (
    bundle.currentMemberEnvelopes.stateHash !== bundle.currentState.stateHash
  ) {
    return {
      code: "hash_mismatch",
      message: "member envelope state hash does not match current principal",
    };
  }
  if (bundle.currentMemberEnvelopes.epoch !== bundle.currentState.keyEpoch) {
    return {
      code: "hash_mismatch",
      message: "member envelope epoch does not match current principal",
    };
  }
  if (
    bundle.currentPayload.principalType !== bundle.currentState.principalType ||
    bundle.currentPayload.principalId !== bundle.currentState.principalId
  ) {
    return {
      code: "object_mismatch",
      message: "payload principal does not match current principal",
    };
  }
  if (bundle.currentPayload.stateHash !== bundle.currentState.stateHash) {
    return {
      code: "hash_mismatch",
      message: "payload state hash does not match current principal",
    };
  }
  return null;
}

function getCheckpointFailure(
  checkpoint: PrincipalPolicyCheckpoint | null,
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyValidationFailure | null {
  if (!checkpoint) {
    return null;
  }
  const current = bundle.currentState;
  if (current.version < checkpoint.version) {
    return {
      code: "rollback",
      message: "principal policy state is older than the local checkpoint",
    };
  }
  if (
    current.version === checkpoint.version &&
    current.stateHash !== checkpoint.stateHash
  ) {
    return {
      code: "equivocation",
      message: "principal policy state conflicts with the local checkpoint",
    };
  }
  if (current.version === checkpoint.version) {
    return null;
  }
  const checkpointState = principalPolicyStates(bundle).find(
    (state) => state.version === checkpoint.version,
  );
  return checkpointState?.stateHash === checkpoint.stateHash
    ? null
    : {
        code: "stale_predecessor",
        message: "principal policy chain does not extend the local checkpoint",
      };
}

function signerPublicKeyLoadFailure(
  code: PrincipalPolicySignerPublicKeyLoadErrorCode,
): PrincipalPolicyValidationFailure {
  switch (code) {
    case "fingerprint-mismatch":
      return {
        code: "signer_mismatch",
        message: "signer key fingerprint does not match state signer",
      };
    case "not-found":
      return {
        code: "missing_dependency",
        message: "failed to fetch signer key",
      };
  }
}

function verificationError(
  failure: PrincipalPolicyValidationFailure,
): KeyingVerificationError {
  return new KeyingVerificationError(failure.code, failure.message);
}

export async function validatePrincipalPolicyBundleForCache(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly loadExternalAdminPolicy: () => Promise<VerifiedExternalAdminPolicy | null>;
  readonly localCheckpoint: PrincipalPolicyCheckpoint | null;
  readonly reference: ReferencedPrincipalStateResponse;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<
  | {
      readonly externalAdminPolicy: VerifiedExternalAdminPolicy | null;
      readonly ok: true;
      readonly policy: VerifiedPrincipalPolicy;
    }
  | { readonly error: KeyingVerificationError; readonly ok: false }
> {
  const referenceFailure = getBundleReferenceFailure(
    input.reference,
    input.bundle,
  );
  if (referenceFailure) {
    return { error: verificationError(referenceFailure), ok: false };
  }
  const checkpointFailure = getCheckpointFailure(
    input.localCheckpoint,
    input.bundle,
  );
  if (checkpointFailure) {
    return { error: verificationError(checkpointFailure), ok: false };
  }
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle: input.bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in signerPublicKeys) {
    return {
      error: verificationError(
        signerPublicKeyLoadFailure(signerPublicKeys.error),
      ),
      ok: false,
    };
  }

  let usedExternalAdminPolicy = false;
  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle: input.bundle,
      expectedReference: input.reference,
      loadExternalAuthority: async () => {
        usedExternalAdminPolicy = true;
        return (
          (await input.loadExternalAdminPolicy())?.externalAuthority ?? null
        );
      },
      localCheckpoint: input.localCheckpoint,
      signerPublicKeys: signerPublicKeys.signerPublicKeys,
    });
  return verified.ok
    ? {
        externalAdminPolicy: usedExternalAdminPolicy
          ? await input.loadExternalAdminPolicy()
          : null,
        ok: true,
        policy: verified.value,
      }
    : { error: verified.error, ok: false };
}
