import {
  KeyingVerificationError,
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { withUnauthenticatedPolicyIdentities } from "../../principals/principalIdentityCommitments";
import { principalPolicyBundleStates } from "../../principals/principalPolicyStates";
import { ProjectionDependencyUnavailableError } from "../dependencyUnavailable";
import type { ProjectionUserKeyResolver } from "../types";

/**
 * Signers and committed members of a fetched bundle, compared before its
 * signatures are checked and pinned only by `publishVerifiedPolicyBundle`
 * once the caller's verification succeeds.
 */
export async function collectPrincipalPolicySignerPublicKeys(input: {
  bundle: PrincipalPolicyBundleResponse;
  label: string;
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<PrincipalPolicySignerPublicKey[]> {
  const states = principalPolicyBundleStates(input.bundle);
  // Signatures are checked after collection: compare, but pin nothing yet.
  return withUnauthenticatedPolicyIdentities(
    {
      signerUserIds: states.map((state) => state.signerUserId),
      projections: [
        ...input.bundle.previousStates.map((entry) => entry.projection),
        input.bundle.currentProjection,
      ],
      resolveTrustedUserIdentity: input.resolveUserKey,
    },
    async (resolve) => {
      const signers = new Map<string, PrincipalPolicySignerPublicKey>();
      for (const state of states) {
        const cacheKey = `${state.signerUserId}:${state.signerUserKeyFingerprint}`;
        if (signers.has(cacheKey)) continue;
        const signerKey = await resolve(state.signerUserId);
        if (!signerKey) {
          throw new ProjectionDependencyUnavailableError(
            `${input.label} signer key could not be resolved for ${state.signerUserId}`,
          );
        }
        const signingKeyFingerprint = await toFingerprint(
          signerKey.signingPublicKey,
        );
        if (signingKeyFingerprint !== state.signerUserKeyFingerprint) {
          throw new KeyingVerificationError(
            "signer_mismatch",
            `${input.label} signer key fingerprint mismatch`,
          );
        }
        signers.set(cacheKey, {
          userId: state.signerUserId,
          signingKeyFingerprint,
          signingPublicKey: signerKey.signingPublicKey,
        });
      }
      return [...signers.values()];
    },
  );
}
