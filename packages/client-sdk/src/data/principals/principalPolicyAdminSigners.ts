import {
  KeyingVerificationError,
  type KeyingVerificationResult,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyExternalAuthority,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

export function principalPolicyReferenceFromBundle(
  bundle: PrincipalPolicyBundleResponse,
): ReferencedPrincipalHead {
  return {
    principalType: bundle.currentState.principalType,
    principalId: bundle.currentState.principalId,
    version: bundle.currentState.version,
    keyEpoch: bundle.currentState.keyEpoch,
    stateHash: bundle.currentState.stateHash,
    keyFingerprint: bundle.currentState.keyFingerprint,
  };
}

export function organizationAdminSignerUserIds(
  policy: VerifiedPrincipalPolicy,
): string[] {
  return [
    ...new Set(
      policy.projection
        .filter((member) => member.role === "admin")
        .map((member) => member.userId),
    ),
  ].sort();
}

export function organizationAdminExternalAuthority(
  policy: VerifiedPrincipalPolicy,
): PrincipalPolicyExternalAuthority {
  const history = policy.history ?? [
    {
      state: policy.state,
      projection: policy.projection,
      grants: policy.grants,
    },
  ];
  const toHead = (state: (typeof history)[number]["state"]) => ({
    principalType: "group" as const,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  });
  return {
    currentHead: toHead(policy.state),
    states: history.map((entry) => ({
      head: toHead(entry.state),
      projection: entry.projection,
    })),
  };
}

export async function verifyOrganizationAdminPolicy(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly localCheckpoint?: PrincipalPolicyCheckpoint | null | undefined;
  readonly organizationId: string;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}): Promise<KeyingVerificationResult<VerifiedPrincipalPolicy>> {
  if (
    input.bundle.currentState.principalType !== "organization" ||
    input.bundle.currentState.principalId !== input.organizationId
  ) {
    return {
      ok: false,
      error: new KeyingVerificationError(
        "object_mismatch",
        "organization policy does not match the expected organization",
      ),
    };
  }

  return verifyPrincipalPolicyBundle({
    bundle: input.bundle,
    expectedReference: principalPolicyReferenceFromBundle(input.bundle),
    localCheckpoint: input.localCheckpoint ?? null,
    signerPublicKeys: input.signerPublicKeys,
  });
}

export async function verifyPrincipalPolicyBundleWithExternalOrganizationAdmins(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly expectedReference: ReferencedPrincipalHead;
  readonly loadExternalAuthority: () => Promise<PrincipalPolicyExternalAuthority | null>;
  readonly localCheckpoint?: PrincipalPolicyCheckpoint | null | undefined;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}): Promise<KeyingVerificationResult<VerifiedPrincipalPolicy>> {
  const verified = await verifyPrincipalPolicyBundle({
    bundle: input.bundle,
    expectedReference: input.expectedReference,
    localCheckpoint: input.localCheckpoint ?? null,
    signerPublicKeys: input.signerPublicKeys,
  });
  if (verified.ok || verified.error.code !== "unauthorized") {
    return verified;
  }

  const externalAuthority = await input.loadExternalAuthority();
  if (!externalAuthority) {
    return verified;
  }

  const verifiedWithExternalAdmins = await verifyPrincipalPolicyBundle({
    bundle: input.bundle,
    externalAuthority,
    expectedReference: input.expectedReference,
    localCheckpoint: input.localCheckpoint ?? null,
    signerPublicKeys: input.signerPublicKeys,
  });

  return verifiedWithExternalAdmins;
}
