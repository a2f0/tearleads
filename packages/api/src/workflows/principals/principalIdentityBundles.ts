import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  computeUserIdentityBundleFingerprint,
  type PrincipalProjectionMember,
  type PrincipalStateMemberEnvelope,
  throwPrincipalPolicyValidationError,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { listRegisteredUserIdentityKeys } from "../../access/read/principalIdentityBundles";

/** Validate every admission against actual registered keys, not unsigned fingerprint columns. */
export async function assertPrincipalIdentityBundles(input: {
  readonly executor: DatabaseSession;
  readonly identityTrustDomain: string;
  readonly projection: readonly PrincipalProjectionMember[];
  readonly memberEnvelopes: readonly PrincipalStateMemberEnvelope[];
}): Promise<void> {
  if (!input.identityTrustDomain)
    throw new Error("Principal policy identity trust domain is required");
  const keys = await listRegisteredUserIdentityKeys(
    input.executor,
    input.projection.map((member) => member.userId),
  );
  const identities = new Map(keys.map((key) => [key.userId, key]));
  const envelopes = new Map(
    input.memberEnvelopes.map((envelope) => [envelope.userId, envelope]),
  );
  for (const member of input.projection) {
    const identity = identities.get(member.userId);
    if (!identity) {
      throwPrincipalPolicyValidationError(
        "invalid_artifact",
        `Missing registered principal member identity ${member.userId}`,
      );
    }
    const signingPublicKey = base64ToBytes(identity.signingPublicKey);
    const encapsulationPublicKey = base64ToBytes(
      identity.encapsulationPublicKey,
    );
    const [bundleFingerprint, signingFingerprint, encapsulationFingerprint] =
      await Promise.all([
        computeUserIdentityBundleFingerprint({
          identityTrustDomain: input.identityTrustDomain,
          userId: member.userId,
          signingPublicKey,
          encapsulationPublicKey,
        }),
        toFingerprint(signingPublicKey),
        toFingerprint(encapsulationPublicKey),
      ]);
    if (
      member.identityBundleFingerprint !== bundleFingerprint ||
      identity.signingKeyFingerprint !== signingFingerprint ||
      identity.encapsulationKeyFingerprint !== encapsulationFingerprint
    ) {
      throwPrincipalPolicyValidationError(
        "invalid_artifact",
        `Principal member identity bundle mismatch for ${member.userId}`,
      );
    }
    if (
      envelopes.get(member.userId)?.memberKeyFingerprint !==
      encapsulationFingerprint
    ) {
      throwPrincipalPolicyValidationError(
        "invalid_artifact",
        `Principal member envelope identity key mismatch for ${member.userId}`,
      );
    }
  }
}
