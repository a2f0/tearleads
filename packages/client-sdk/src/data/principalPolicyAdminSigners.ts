import {
  type KeyingVerificationResult,
  type PrincipalPolicyCheckpoint,
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

function organizationAdminSignerUserIds(
  policy: VerifiedPrincipalPolicy,
): string[] {
  return [
    ...new Set(
      policy.projection
        .filter(
          (member) =>
            member.memberPrincipalType === "user" && member.role === "admin",
        )
        .map((member) => member.memberPrincipalId),
    ),
  ].sort();
}

export async function verifyOrganizationAdminSignerUserIds(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly localCheckpoint?: PrincipalPolicyCheckpoint | null | undefined;
  readonly organizationId: string;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}): Promise<string[]> {
  if (
    input.bundle.currentState.principalType !== "organization" ||
    input.bundle.currentState.principalId !== input.organizationId
  ) {
    return [];
  }

  const verified = await verifyPrincipalPolicyBundle({
    bundle: input.bundle,
    expectedReference: principalPolicyReferenceFromBundle(input.bundle),
    localCheckpoint: input.localCheckpoint ?? null,
    signerPublicKeys: input.signerPublicKeys,
  });

  return verified.ok ? organizationAdminSignerUserIds(verified.value) : [];
}

export async function verifyPrincipalPolicyBundleWithExternalOrganizationAdmins(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly expectedReference: ReferencedPrincipalHead;
  readonly loadExternalAdminSignerUserIds: () => Promise<readonly string[]>;
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

  const externalAdminSignerUserIds =
    await input.loadExternalAdminSignerUserIds();
  if (externalAdminSignerUserIds.length === 0) {
    return verified;
  }

  const verifiedWithExternalAdmins = await verifyPrincipalPolicyBundle({
    bundle: input.bundle,
    externalAdminSignerUserIds,
    expectedReference: input.expectedReference,
    localCheckpoint: input.localCheckpoint ?? null,
    signerPublicKeys: input.signerPublicKeys,
  });

  return verifiedWithExternalAdmins.ok ? verifiedWithExternalAdmins : verified;
}
