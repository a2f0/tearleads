/**
 * How this device came to trust a pin. `self` is the user's own local keys,
 * `link` an independently exchanged identity link, and `observed` the first
 * server answer for a user already referenced by signed state. Only `self` and
 * `link` admit a user; provenance only ever rises, and never changes the keys.
 */
export type TrustedUserIdentityPinProvenance = "self" | "link" | "observed";

export interface TrustedUserIdentityPin {
  readonly identityTrustDomain: string;
  readonly userId: string;
  readonly formatVersion: number;
  readonly signingSuite: string;
  readonly signingPublicKey: string;
  readonly signingKeyFingerprint: string;
  readonly encapsulationSuite: string;
  readonly encapsulationPublicKey: string;
  readonly encapsulationKeyFingerprint: string;
  readonly firstSeenAt: string;
  readonly provenance: TrustedUserIdentityPinProvenance;
}

export type ComparedPinField =
  | "userId"
  | "formatVersion"
  | "signingSuite"
  | "signingPublicKey"
  | "signingKeyFingerprint"
  | "encapsulationSuite"
  | "encapsulationPublicKey"
  | "encapsulationKeyFingerprint";

interface PinDiagnostic {
  readonly userId: string;
  readonly formatVersion: number;
  readonly signingSuite: string;
  readonly signingKeyFingerprint: string;
  readonly encapsulationSuite: string;
  readonly encapsulationKeyFingerprint: string;
  readonly firstSeenAt: string;
}

export interface PinScope {
  readonly identityTrustDomain: string;
  readonly userId: string;
}

const comparedPinFields: readonly ComparedPinField[] = [
  "userId",
  "formatVersion",
  "signingSuite",
  "signingPublicKey",
  "signingKeyFingerprint",
  "encapsulationSuite",
  "encapsulationPublicKey",
  "encapsulationKeyFingerprint",
];

function pinDiagnostic(pin: TrustedUserIdentityPin): PinDiagnostic {
  return {
    userId: pin.userId,
    formatVersion: pin.formatVersion,
    signingSuite: pin.signingSuite,
    signingKeyFingerprint: pin.signingKeyFingerprint,
    encapsulationSuite: pin.encapsulationSuite,
    encapsulationKeyFingerprint: pin.encapsulationKeyFingerprint,
    firstSeenAt: pin.firstSeenAt,
  };
}

export class TrustedUserIdentityPinMismatchError extends Error {
  readonly code = "trusted_user_identity_pin_mismatch";
  readonly identityTrustDomain: string;
  readonly userId: string;
  readonly existing: PinDiagnostic;
  readonly candidate: PinDiagnostic;
  readonly differingFields: readonly ComparedPinField[];

  constructor(
    existing: TrustedUserIdentityPin,
    candidate: TrustedUserIdentityPin,
    differingFields: readonly ComparedPinField[],
  ) {
    super(
      `Trusted identity pin mismatch for ${candidate.userId} in ${candidate.identityTrustDomain}: ${differingFields.join(", ")}`,
    );
    this.name = "TrustedUserIdentityPinMismatchError";
    this.identityTrustDomain = candidate.identityTrustDomain;
    this.userId = candidate.userId;
    this.existing = pinDiagnostic(existing);
    this.candidate = pinDiagnostic(candidate);
    this.differingFields = differingFields;
  }
}

export class TrustedUserIdentityPinCorruptError extends Error {
  readonly code = "trusted_user_identity_pin_corrupt";
  readonly identityTrustDomain: string;
  readonly userId: string;
  readonly reason: string;

  constructor(scope: PinScope, reason: string) {
    super(
      `Stored trusted identity pin is corrupt for ${scope.userId} in ${scope.identityTrustDomain}: ${reason}`,
    );
    this.name = "TrustedUserIdentityPinCorruptError";
    this.identityTrustDomain = scope.identityTrustDomain;
    this.userId = scope.userId;
    this.reason = reason;
  }
}

export class TrustedUserIdentityPinInputError extends Error {
  readonly code = "trusted_user_identity_pin_invalid_input";
  readonly identityTrustDomain: string;
  readonly userId: string;
  readonly reason: string;

  constructor(scope: PinScope, reason: string) {
    super(`Invalid trusted identity pin candidate: ${reason}`);
    this.name = "TrustedUserIdentityPinInputError";
    this.identityTrustDomain = scope.identityTrustDomain;
    this.userId = scope.userId;
    this.reason = reason;
  }
}

export function differingPinFields(
  existing: TrustedUserIdentityPin,
  candidate: TrustedUserIdentityPin,
): readonly ComparedPinField[] {
  return comparedPinFields.filter(
    (field) => existing[field] !== candidate[field],
  );
}
