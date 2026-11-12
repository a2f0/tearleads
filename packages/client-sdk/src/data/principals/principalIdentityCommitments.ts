import {
  computeUserIdentityBundleFingerprint,
  KeyingVerificationError,
  type PrincipalProjectionMember,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { ProjectionDependencyUnavailableError } from "../keyingProjectionVerification/dependencyUnavailable";
import type {
  StagedUserIdentityOptions,
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
  /** The calling operation's lifetime, checked inside every pin write. */
  readonly assertCurrent?: (() => void) | undefined;
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
    { publish: input.authenticated, assertCurrent: input.assertCurrent },
  );
}

interface PolicyIdentities {
  readonly signerUserIds: readonly string[];
  readonly projections: readonly (readonly PrincipalProjectionMember[])[];
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

/** One staged scope over a policy's signers and committed members. */
function withPolicyIdentities<T>(
  input: PolicyIdentities,
  resolveSigners: (resolve: StagedUserIdentityResolver) => Promise<T>,
  options: StagedUserIdentityOptions,
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
    options,
  );
}

/**
 * Resolve a policy's signers and compare its members' commitments before any
 * signature is checked, pinning nothing: a signer or member seen for the
 * first time stays staged, so a refused bundle leaves no durable pin to block
 * a corrected retry or the honest identity link. Existing pins are used as
 * they are. Callers pin first sights with `publishVerifiedPolicyIdentities`
 * once their own verification succeeds.
 */
export function withUnauthenticatedPolicyIdentities<T>(
  input: PolicyIdentities,
  resolveSigners: (resolve: StagedUserIdentityResolver) => Promise<T>,
): Promise<T> {
  return withPolicyIdentities(input, resolveSigners, { publish: false });
}

/**
 * Pin a verified policy's signers and committed members, after the caller's
 * own verification of exactly these states and projections succeeded. The
 * answers are resolved again (existing pins as stored) and every signer's
 * signed fingerprint and committed bundle rechecked, so an answer changed
 * since verification is refused rather than pinned. A later substituted
 * answer then conflicts with this pin instead of becoming one.
 */
async function publishVerifiedPolicyIdentities(input: {
  readonly signers: readonly {
    readonly userId: string;
    readonly signingKeyFingerprint: string;
  }[];
  readonly projections: readonly (readonly PrincipalProjectionMember[])[];
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly assertCurrent?: (() => void) | undefined;
}): Promise<void> {
  // Without staging, ordinary resolution already pinned every first sight.
  if (!input.resolveTrustedUserIdentity.withPinnedIdentities) return;
  await withPolicyIdentities(
    {
      signerUserIds: input.signers.map((signer) => signer.userId),
      projections: input.projections,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    },
    async (resolve) => {
      for (const signer of input.signers) {
        const identity = await resolve(signer.userId);
        if (!identity)
          throw new ProjectionDependencyUnavailableError(
            `Principal policy signer identity is unavailable: ${signer.userId}`,
          );
        if (identity.signingKeyFingerprint !== signer.signingKeyFingerprint)
          throw new KeyingVerificationError(
            "signer_mismatch",
            "Principal policy signer identity changed after verification",
          );
      }
    },
    { publish: true, assertCurrent: input.assertCurrent },
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
  assertCurrent: () => void,
): Promise<void> {
  return assertPrincipalIdentityCommitments({
    assertCurrent,
    authenticated: true,
    projections: policies.flatMap((policy) => [
      policy.projection,
      ...policy.retainedHistory.map((entry) => entry.projection),
    ]),
    resolveTrustedUserIdentity,
  });
}

/** Pin a bundle the caller just verified: every state's signer and projection. */
export function publishVerifiedPolicyBundle(
  bundle: Pick<
    PrincipalPolicyBundleResponse,
    "currentState" | "previousStates" | "currentProjection"
  >,
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
  assertCurrent?: () => void,
): Promise<void> {
  const entries = [
    ...bundle.previousStates,
    { state: bundle.currentState, projection: bundle.currentProjection },
  ];
  return publishVerifiedPolicyIdentities({
    signers: entries.map(({ state }) => ({
      userId: state.signerUserId,
      signingKeyFingerprint: state.signerUserKeyFingerprint,
    })),
    projections: entries.map((entry) => entry.projection),
    resolveTrustedUserIdentity,
    assertCurrent,
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
