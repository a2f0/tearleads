import {
  computeUserIdentityBundleFingerprint,
  KeyingVerificationError,
  type PrincipalProjectionMember,
} from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../keyingProjectionVerification/dependencyUnavailable";
import type {
  StagedUserIdentityResolver,
  TrustedUserIdentityResolver,
} from "../trustedUserIdentity";

/**
 * Structural verification only: never recurse into roster admission here.
 * Pass `authenticated` only once every projection's signed state verified.
 * Before that, a member seen for the first time is compared but not pinned,
 * so neither a forged projection nor a refused candidate reaches the store.
 */
export async function assertPrincipalIdentityCommitments(input: {
  readonly authenticated: boolean;
  readonly projections: readonly (readonly PrincipalProjectionMember[])[];
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<void> {
  const resolver = input.resolveTrustedUserIdentity;
  if (!resolver.withPinnedIdentities)
    return compareCommitments(input.projections, resolver);
  return resolver.withPinnedIdentities(
    [
      ...new Set(
        input.projections.flatMap((projection) =>
          projection.map((member) => member.userId),
        ),
      ),
    ],
    (resolve) => compareCommitments(input.projections, resolve),
    { publish: input.authenticated },
  );
}

async function compareCommitments(
  projections: readonly (readonly PrincipalProjectionMember[])[],
  resolve: StagedUserIdentityResolver,
): Promise<void> {
  const identities = new Map<string, Promise<string>>();
  for (const projection of projections) {
    for (const member of projection) {
      let fingerprint = identities.get(member.userId);
      if (!fingerprint) {
        fingerprint = (async () => {
          const identity = await resolve(member.userId);
          if (!identity)
            throw new ProjectionDependencyUnavailableError(
              `Principal member identity is unavailable: ${member.userId}`,
            );
          if (identity.userId !== member.userId)
            throw new KeyingVerificationError(
              "hash_mismatch",
              "Principal member identity has the wrong user",
            );
          return computeUserIdentityBundleFingerprint(identity);
        })();
        identities.set(member.userId, fingerprint);
      }
      if ((await fingerprint) !== member.identityBundleFingerprint)
        throw new KeyingVerificationError(
          "hash_mismatch",
          `Principal member identity bundle mismatch: ${member.userId}`,
        );
    }
  }
}

export async function createPrincipalProjectionMember(
  identity: {
    readonly userId: string;
    readonly identityTrustDomain: string;
    readonly signingPublicKey: Uint8Array;
    readonly encapsulationPublicKey: Uint8Array;
  },
  role: "member" | "admin",
): Promise<PrincipalProjectionMember> {
  if (!identity.identityTrustDomain)
    throw new Error("Identity trust domain is unavailable");
  return {
    userId: identity.userId,
    role,
    identityBundleFingerprint:
      await computeUserIdentityBundleFingerprint(identity),
  };
}
