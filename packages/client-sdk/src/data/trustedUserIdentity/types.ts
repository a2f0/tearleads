import type { ExecSql } from "../sqlite/sqlSchema";

export const TRUSTED_USER_IDENTITY_FORMAT_VERSION = 1;
export const TRUSTED_USER_IDENTITY_SIGNING_SUITE = "ML-DSA-87";
export const TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE = "ML-KEM-1024";

const trustedUserIdentityBrand: unique symbol = Symbol("trustedUserIdentity");
const trustedUserIdentityBrandValue = true;

/**
 * A complete user identity bundle that has passed strict key validation and
 * the durable trust-on-first-use comparison for its trust domain.
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
  invalidate?(userId: string): void;
  load(userId: string): Promise<RemoteUserIdentityCandidate | null>;
}

export interface LocalUserIdentityCandidate {
  readonly encapsulationPublicKey: Uint8Array;
  readonly signingKeyFingerprint?: string | null | undefined;
  readonly signingPublicKey: Uint8Array;
}

export interface TrustedUserIdentityService {
  pinLocal(
    userId: string,
    candidate: LocalUserIdentityCandidate,
  ): Promise<TrustedUserIdentity>;
  resolve(userId: string): Promise<TrustedUserIdentity | null>;
}

export type TrustedUserIdentityResolver = TrustedUserIdentityService["resolve"];

export interface TrustedUserIdentityServiceDependencies {
  readonly getExecSql: () => ExecSql | null;
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
