import {
  computeUserIdentityBundleFingerprint,
  type PrincipalPolicySignerPublicKey,
  type PrincipalProjectionMember,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import {
  type AuthenticatedSigner,
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

interface TrustedSigner {
  readonly identity: NonNullable<
    Awaited<ReturnType<StagedUserIdentityResolver>>
  >;
  readonly publicKey: PrincipalPolicySignerPublicKey;
  bundleFingerprint?: Promise<string>;
}

async function loadTrustedSigner(input: {
  readonly resolve: StagedUserIdentityResolver;
  readonly state: PrincipalPolicyBundleResponse["currentState"];
}): Promise<TrustedSigner> {
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
    identity: signerKey,
    publicKey: {
      userId: input.state.signerUserId,
      signingKeyFingerprint: input.state.signerUserKeyFingerprint,
      signingPublicKey: signerKey.signingPublicKey,
    },
  };
}

type SignedProjection = {
  readonly version: number;
  readonly stateHash: string;
  readonly projection: readonly PrincipalProjectionMember[];
};

/**
 * The signer's identity as its predecessor's signed projection committed it,
 * when the state links to that predecessor: an unlinked entry is left for the
 * chain verifier to refuse as disconnected.
 */
function committedSignerBundle(
  state: PrincipalPolicyBundleResponse["currentState"],
  predecessors: ReadonlyMap<number, SignedProjection>,
): string | undefined {
  const predecessor = predecessors.get(state.version - 1);
  if (!predecessor || predecessor.stateHash !== state.prevStateHash)
    return undefined;
  return predecessor.projection.find(
    (member) => member.userId === state.signerUserId,
  )?.identityBundleFingerprint;
}

/**
 * The signers of chain entries the history verifier accepted, each with the
 * identity bundle its hash-linked predecessor's signed projection committed,
 * or, with no linked predecessor (a genesis founder), the bundle its own
 * signed projection commits. A signer in neither is an external authority
 * whose Admins policy pins it. Published once the chain reaches its head.
 */
export function acceptedEntrySigners(
  entries: readonly {
    readonly state: PrincipalPolicyBundleResponse["currentState"];
    readonly projection: readonly PrincipalProjectionMember[];
  }[],
  predecessor: SignedProjection | null,
): AuthenticatedSigner[] {
  const predecessors = new Map<number, SignedProjection>(
    [
      ...(predecessor ? [predecessor] : []),
      ...entries.map((entry) => ({
        version: entry.state.version,
        stateHash: entry.state.stateHash,
        projection: entry.projection,
      })),
    ].map((entry) => [entry.version, entry]),
  );
  return entries.map(({ state, projection }) => ({
    userId: state.signerUserId,
    signingKeyFingerprint: state.signerUserKeyFingerprint,
    identityBundleFingerprint:
      committedSignerBundle(state, predecessors) ??
      projection.find((member) => member.userId === state.signerUserId)
        ?.identityBundleFingerprint,
  }));
}

export async function collectPrincipalPolicySignerPublicKeys(input: {
  readonly bundle: Pick<
    PrincipalPolicyBundleResponse,
    "currentState" | "previousStates" | "currentProjection"
  >;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  /**
   * A paged history's last accepted state, which authorizes the page's first
   * signer by user ID: that signer must be the identity it committed.
   */
  readonly predecessor?: SignedProjection | null;
}): Promise<
  | { readonly signerPublicKeys: PrincipalPolicySignerPublicKey[] }
  | { readonly error: PrincipalPolicySignerPublicKeyLoadErrorCode }
> {
  const states = principalPolicyStates(input.bundle);
  const predecessors = new Map<number, SignedProjection>(
    [
      ...(input.predecessor ? [input.predecessor] : []),
      ...input.bundle.previousStates.map((entry) => ({
        version: entry.state.version,
        stateHash: entry.state.stateHash,
        projection: entry.projection,
      })),
    ].map((entry) => [entry.version, entry]),
  );
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
        const signers = new Map<string, TrustedSigner>();
        for (const state of states) {
          const cacheKey = signerCacheKey({
            signerUserId: state.signerUserId,
            signingFingerprint: state.signerUserKeyFingerprint,
          });
          let signer = signers.get(cacheKey);
          if (!signer) {
            signer = await loadTrustedSigner({ resolve, state });
            signers.set(cacheKey, signer);
          }
          const committed = committedSignerBundle(state, predecessors);
          if (committed === undefined) continue;
          signer.bundleFingerprint ??= computeUserIdentityBundleFingerprint(
            signer.identity,
          );
          if ((await signer.bundleFingerprint) !== committed)
            throw new SignerLoadRefusal("fingerprint-mismatch");
        }
        return {
          signerPublicKeys: Array.from(
            signers.values(),
            (signer) => signer.publicKey,
          ),
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
