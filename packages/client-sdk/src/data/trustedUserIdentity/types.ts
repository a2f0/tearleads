import type { ExecSql } from "../sqlite/sqlSchema";

export const TRUSTED_USER_IDENTITY_FORMAT_VERSION = 1;
export const TRUSTED_USER_IDENTITY_SIGNING_SUITE = "ML-DSA-87";
export const TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE = "ML-KEM-1024";

const trustedUserIdentityBrand: unique symbol = Symbol("trustedUserIdentity");
const trustedUserIdentityBrandValue = true;

/**
 * A complete user identity bundle that has passed strict key validation and
 * the durable pin comparison for its trust domain.
 *
 * The nominal brand keeps raw API and organization response objects from being
 * accepted at cryptographic boundaries by structural typing. Its private
 * symbol and constructor remain package-private to the SDK trust gateway.
 */
export interface TrustedUserIdentity {
  readonly [trustedUserIdentityBrand]: true;
  readonly encapsulationKeyFingerprint: string;
  readonly encapsulationPublicKey: Uint8Array;
  readonly identityTrustDomain: string;
  readonly signingKeyFingerprint: string;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}

/** Strictly decoded and self-consistent, but not yet accepted by durable TOFU. */
export interface ValidatedUserIdentityCandidate {
  readonly encapsulationKeyFingerprint: string;
  readonly encapsulationPublicKey: Uint8Array;
  readonly identityTrustDomain: string;
  readonly signingKeyFingerprint: string;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}

export interface RemoteUserIdentityCandidate {
  readonly encapsulationKeyFingerprint: string;
  readonly encapsulationPublicKey: string;
  readonly signingKeyFingerprint: string;
  readonly signingPublicKey: string;
  readonly userId: string;
}

export interface RemoteUserIdentitySource {
  invalidate(userId: string): void;
  /**
   * `null` only when the server asserts the user does not exist. A transport
   * or non-404 HTTP failure throws a retryable availability error instead.
   */
  load(userId: string): Promise<RemoteUserIdentityCandidate | null>;
}

export interface LocalUserIdentityCandidate {
  readonly encapsulationPublicKey: Uint8Array;
  readonly signingKeyFingerprint?: string | null | undefined;
  readonly signingPublicKey: Uint8Array;
}

/** An existing pin as an admission reads it: never admits by itself. */
export interface TrustedUserIdentityAdmissionPin {
  readonly identity: TrustedUserIdentity;
  /** Established by a verified identity link or this device's own keys. */
  readonly verified: boolean;
}

export interface TrustedUserIdentityService {
  createLink(appUrl: string): Promise<string>;
  /**
   * Link for `userId` from a pin a verified link or this device's keys
   * established; the local user's own keys for the signed-in user; `null`
   * when no such pin exists (never from an observed pin).
   */
  createLinkFor(userId: string, appUrl: string): Promise<string | null>;
  verifyLink(link: string): Promise<TrustedUserIdentity>;
  /** Any existing pin, including one observed on first sight. Never admits. */
  resolvePinned(userId: string): Promise<TrustedUserIdentity | null>;
  /** An existing pin established by a verified link or this device's keys. */
  resolveVerified(userId: string): Promise<TrustedUserIdentity | null>;
  /**
   * Like `resolveVerified`, but throws `UnverifiedUserIdentityError`. An
   * admission passes the database its mutation captured: a trust store that
   * is not, or stops being, that database fails with `DatabaseUnavailableError`
   * instead of admitting against another scope.
   */
  requireVerified(
    userId: string,
    admittingExecSql: ExecSql | null,
  ): Promise<TrustedUserIdentity>;
  /**
   * Any existing pin and whether a link or this device's keys established it,
   * read with `requireVerified`'s database scoping. Admissions that accept
   * evidence other than a verified pin compare against it.
   */
  loadAdmissionPin(
    userId: string,
    admittingExecSql: ExecSql | null,
  ): Promise<TrustedUserIdentityAdmissionPin | null>;
  /** The user this device's trust store already binds a signing key to. */
  boundUserId(signingKeyFingerprint: string): Promise<string | null>;
  pinLocal(
    userId: string,
    candidate: LocalUserIdentityCandidate,
  ): Promise<TrustedUserIdentity>;
  /** Pins on first sight as `observed`; for users signed state references. */
  resolve: TrustedUserIdentityResolver;
}

/**
 * Within one structural check: an existing pin, this user's own local keys,
 * or a first-sight candidate that is staged rather than pinned.
 */
export type StagedUserIdentityResolver = (
  userId: string,
) => Promise<ValidatedUserIdentityCandidate | null>;

export interface StagedUserIdentityOptions {
  /**
   * Pin staged first sights as `observed` once `verify` succeeds. Set only
   * when the checked projections' signed states already verified: data an
   * unauthenticated projection names must never reach the durable store.
   */
  readonly publish: boolean;
}

/** Callable resolution always compares the candidate with durable pins.
 * Structural commitment verification may reuse validated immutable pins for
 * one scoped operation; this capability never admits users or promotes pins.
 */
export type TrustedUserIdentityResolver = ((
  userId: string,
) => Promise<TrustedUserIdentity | null>) & {
  readonly withPinnedIdentities?: <T>(
    userIds: readonly string[],
    verify: (resolve: StagedUserIdentityResolver) => Promise<T>,
    options: StagedUserIdentityOptions,
  ) => Promise<T>;
};

export interface TrustedUserIdentityServiceDependencies {
  readonly getExecSql: () => ExecSql | null;
  readonly getScopeGeneration?: (() => unknown) | undefined;
  readonly getLocalIdentity: (
    userId: string,
  ) => LocalUserIdentityCandidate | null;
  readonly getLocalUserId: () => string | null;
  readonly identityTrustDomain: string | null;
  readonly now?: (() => Date) | undefined;
  readonly remoteSource: RemoteUserIdentitySource;
}

export function brandTrustedUserIdentity(
  input: ValidatedUserIdentityCandidate,
): TrustedUserIdentity {
  return {
    ...input,
    [trustedUserIdentityBrand]: trustedUserIdentityBrandValue,
  };
}

export function isTrustedUserIdentity(
  value: unknown,
): value is TrustedUserIdentity {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, trustedUserIdentityBrand) ===
      trustedUserIdentityBrandValue
  );
}
