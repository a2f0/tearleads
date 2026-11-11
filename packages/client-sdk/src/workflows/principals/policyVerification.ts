import type { PrincipalPolicySignerPublicKey } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import {
  publishVerifiedPolicyBundle,
  withUnauthenticatedPolicyIdentities,
} from "../../data/principals/principalIdentityCommitments";
import {
  requireTrustedUserIdentityResolver,
  type StagedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";

export type PrincipalPolicySignerPublicKeyLoadErrorCode =
  | "fingerprint-mismatch"
  | "not-found";

export function principalPolicyStates(
  bundle: Pick<
    PrincipalPolicyBundleResponse,
    "currentState" | "previousStates"
  >,
): PrincipalPolicyBundleResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

function signerCacheKey(input: {
  readonly signerUserId: string;
  readonly signingFingerprint: string;
}): string {
  return `${input.signerUserId}:${input.signingFingerprint}`;
}

/** A signer refusal ends collection before any commitment is compared. */
class SignerLoadRefusal {
  constructor(readonly code: PrincipalPolicySignerPublicKeyLoadErrorCode) {}
}

async function loadTrustedSignerPublicKey(input: {
  readonly resolve: StagedUserIdentityResolver;
  readonly state: PrincipalPolicyBundleResponse["currentState"];
}): Promise<PrincipalPolicySignerPublicKey> {
  const signerKey = await input.resolve(input.state.signerUserId);

  if (!signerKey) {
    throw new SignerLoadRefusal("not-found");
  }

  if (
    signerKey.signingKeyFingerprint !== input.state.signerUserKeyFingerprint
  ) {
    throw new SignerLoadRefusal("fingerprint-mismatch");
  }

  return {
    userId: input.state.signerUserId,
    signingKeyFingerprint: input.state.signerUserKeyFingerprint,
    signingPublicKey: signerKey.signingPublicKey,
  };
}

export async function collectPrincipalPolicySignerPublicKeys(input: {
  readonly bundle: Pick<
    PrincipalPolicyBundleResponse,
    "currentState" | "previousStates" | "currentProjection"
  >;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<
  | { readonly signerPublicKeys: PrincipalPolicySignerPublicKey[] }
  | { readonly error: PrincipalPolicySignerPublicKeyLoadErrorCode }
> {
  const states = principalPolicyStates(input.bundle);
  try {
    // Signatures are checked after collection: first-sight signers and
    // members are compared, but only a verified selection pins them.
    return await withUnauthenticatedPolicyIdentities(
      {
        signerUserIds: states.map((state) => state.signerUserId),
        projections: [
          ...input.bundle.previousStates.map((entry) => entry.projection),
          input.bundle.currentProjection,
        ],
        resolveTrustedUserIdentity: requireTrustedUserIdentityResolver(
          input.resolveTrustedUserIdentity,
        ),
      },
      async (resolve) => {
        const signerPublicKeysByKey = new Map<
          string,
          PrincipalPolicySignerPublicKey
        >();
        for (const state of states) {
          const cacheKey = signerCacheKey({
            signerUserId: state.signerUserId,
            signingFingerprint: state.signerUserKeyFingerprint,
          });
          if (signerPublicKeysByKey.has(cacheKey)) {
            continue;
          }
          signerPublicKeysByKey.set(
            cacheKey,
            await loadTrustedSignerPublicKey({ resolve, state }),
          );
        }
        return {
          signerPublicKeys: Array.from(signerPublicKeysByKey.values()),
        };
      },
    );
  } catch (error) {
    if (error instanceof SignerLoadRefusal) return { error: error.code };
    throw error;
  }
}

/**
 * Pin the signers and members of a bundle the caller has just verified, so
 * the first sights signer collection staged become durable only now. Call it
 * after every successful verification of a collected bundle.
 */
export function publishVerifiedPrincipalPolicy(input: {
  readonly bundle: Pick<
    PrincipalPolicyBundleResponse,
    "currentState" | "previousStates" | "currentProjection"
  >;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly assertCurrent?: (() => void) | undefined;
  /** The operation's lifetime, checked inside every pin write. */
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  const { stillCurrent } = input;
  return publishVerifiedPolicyBundle(
    input.bundle,
    requireTrustedUserIdentityResolver(input.resolveTrustedUserIdentity),
    input.assertCurrent ??
      (stillCurrent
        ? () => assertProjectionVerificationCurrent(stillCurrent)
        : undefined),
  );
}

/** Pin one recovery's just-verified current state, within its lifetime. */
export function publishVerifiedCurrent(
  options: { readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver },
  current: Pick<
    PrincipalPolicyBundleResponse,
    "currentState" | "currentProjection"
  >,
  stillCurrent: () => boolean,
): Promise<void> {
  return publishVerifiedPrincipalPolicy({
    bundle: { ...current, previousStates: [] },
    resolveTrustedUserIdentity: options.resolveTrustedUserIdentity,
    assertCurrent: () => assertProjectionVerificationCurrent(stillCurrent),
  });
}
