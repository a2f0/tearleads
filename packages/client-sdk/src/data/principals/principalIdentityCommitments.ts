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

/**
 * Resolve a policy's signers and compare its members' commitments before any
 * signature is checked, pinning nothing: a signer or member seen for the
 * first time stays staged, so a refused bundle leaves no durable pin to block
 * a corrected retry or the honest identity link. Existing pins are used as
 * they are. Verified selections publish members' first sights afterwards.
 */
export function withUnauthenticatedPolicyIdentities<T>(
  input: {
    readonly signerUserIds: readonly string[];
    readonly projections: readonly (readonly PrincipalProjectionMember[])[];
    readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  },
  resolveSigners: (resolve: StagedUserIdentityResolver) => Promise<T>,
): Promise<T> {
  const check = async (resolve: StagedUserIdentityResolver) => {
    const signers = await resolveSigners(resolve);
    await compareCommitments(input.projections, resolve);
    return signers;
  };
  const resolver = input.resolveTrustedUserIdentity;
  if (!resolver.withPinnedIdentities) return check(resolver);
  return resolver.withPinnedIdentities(
    [
      ...new Set([
        ...input.signerUserIds,
        ...input.projections.flatMap((projection) =>
          projection.map((member) => member.userId),
        ),
      ]),
    ],
    check,
    { publish: false },
  );
}

/**
 * Check every projection a verified selection hands to authorization, on
 * fresh and restored history alike: a restored prefix reads no page, so this
 * is the only commitment check its members get. Selections are already
 * signature-verified, so their members' first sights are published.
 */
export function assertSelectedPolicyCommitments(
  policies: readonly {
    readonly projection: readonly PrincipalProjectionMember[];
    readonly retainedHistory: readonly {
      readonly projection: readonly PrincipalProjectionMember[];
    }[];
  }[],
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
): Promise<void> {
  return assertPrincipalIdentityCommitments({
    authenticated: true,
    projections: policies.flatMap((policy) => [
      policy.projection,
      ...policy.retainedHistory.map((entry) => entry.projection),
    ]),
    resolveTrustedUserIdentity,
  });
}

/**
 * Pin the members of a history page the chain verifier just accepted. The
 * next page's first signer is authorized only by user ID against this page's
 * last projection, and a member it removes is not rechecked for continuity,
 * so that signer must resolve to the identity this page authenticated rather
 * than to a fresh, possibly substituted, endpoint answer.
 */
export function publishAcceptedPageIdentities(
  entries: readonly {
    readonly projection: readonly PrincipalProjectionMember[];
  }[],
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
): Promise<void> {
  return assertPrincipalIdentityCommitments({
    authenticated: true,
    projections: entries.map((entry) => entry.projection),
    resolveTrustedUserIdentity,
  });
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
