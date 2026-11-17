import {
  TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE,
  TRUSTED_USER_IDENTITY_FORMAT_VERSION,
  TRUSTED_USER_IDENTITY_SIGNING_SUITE,
} from "../../trustedUserIdentity/types";

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

export const provenanceRank: Readonly<
  Record<TrustedUserIdentityPinProvenance, number>
> = { observed: 0, link: 1, self: 2 };

function isTrustedUserIdentityPinProvenance(
  value: unknown,
): value is TrustedUserIdentityPinProvenance {
  return value === "self" || value === "link" || value === "observed";
}

const requiredStringFields = [
  "identityTrustDomain",
  "userId",
  "signingSuite",
  "signingPublicKey",
  "signingKeyFingerprint",
  "encapsulationSuite",
  "encapsulationPublicKey",
  "encapsulationKeyFingerprint",
] as const satisfies readonly (keyof TrustedUserIdentityPin)[];

function pinScope(value: unknown): PinScope {
  if (typeof value !== "object" || value === null) {
    return { identityTrustDomain: "<invalid>", userId: "<invalid>" };
  }
  const identityTrustDomain = Reflect.get(value, "identityTrustDomain");
  const userId = Reflect.get(value, "userId");
  return {
    identityTrustDomain:
      typeof identityTrustDomain === "string"
        ? identityTrustDomain
        : "<invalid>",
    userId: typeof userId === "string" ? userId : "<invalid>",
  };
}

export function validationFailure(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return "row must be an object";
  }
  const formatVersion = Reflect.get(value, "formatVersion");
  if (formatVersion !== TRUSTED_USER_IDENTITY_FORMAT_VERSION) {
    return `formatVersion must be ${TRUSTED_USER_IDENTITY_FORMAT_VERSION}`;
  }
  for (const field of requiredStringFields) {
    const fieldValue = Reflect.get(value, field);
    if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
      return `${field} must be a non-empty string`;
    }
  }
  if (
    Reflect.get(value, "signingSuite") !== TRUSTED_USER_IDENTITY_SIGNING_SUITE
  ) {
    return `signingSuite must be ${TRUSTED_USER_IDENTITY_SIGNING_SUITE}`;
  }
  if (
    Reflect.get(value, "encapsulationSuite") !==
    TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE
  ) {
    return `encapsulationSuite must be ${TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE}`;
  }
  const firstSeenAt = Reflect.get(value, "firstSeenAt");
  if (
    typeof firstSeenAt !== "string" ||
    !Number.isFinite(Date.parse(firstSeenAt))
  ) {
    return "firstSeenAt must be a valid timestamp";
  }
  if (!isTrustedUserIdentityPinProvenance(Reflect.get(value, "provenance"))) {
    return "provenance must be self, link, or observed";
  }
  return null;
}

function validatedStringField(
  value: object,
  field: (typeof requiredStringFields)[number] | "firstSeenAt",
): string {
  const fieldValue = Reflect.get(value, field);
  if (typeof fieldValue !== "string") {
    throw new TypeError(`Validated pin field ${field} is not a string`);
  }
  return fieldValue;
}

function validatedFormatVersion(value: object): number {
  const formatVersion = Reflect.get(value, "formatVersion");
  if (typeof formatVersion !== "number") {
    throw new TypeError("Validated pin formatVersion is not a number");
  }
  return formatVersion;
}

function validatedProvenance(value: object): TrustedUserIdentityPinProvenance {
  const provenance = Reflect.get(value, "provenance");
  if (!isTrustedUserIdentityPinProvenance(provenance)) {
    throw new TypeError("Validated pin provenance is not a provenance");
  }
  return provenance;
}

export function assertCandidatePin(pin: TrustedUserIdentityPin): void {
  const failure = validationFailure(pin);
  if (failure) {
    throw new TrustedUserIdentityPinInputError(pinScope(pin), failure);
  }
}

export function parseStoredPin(
  value: unknown,
  scope: PinScope,
): TrustedUserIdentityPin {
  const failure = validationFailure(value);
  if (failure) {
    throw new TrustedUserIdentityPinCorruptError(scope, failure);
  }
  if (typeof value !== "object" || value === null) {
    throw new TrustedUserIdentityPinCorruptError(
      scope,
      "row must be an object",
    );
  }
  const pin: TrustedUserIdentityPin = {
    identityTrustDomain: validatedStringField(value, "identityTrustDomain"),
    userId: validatedStringField(value, "userId"),
    formatVersion: validatedFormatVersion(value),
    signingSuite: validatedStringField(value, "signingSuite"),
    signingPublicKey: validatedStringField(value, "signingPublicKey"),
    signingKeyFingerprint: validatedStringField(value, "signingKeyFingerprint"),
    encapsulationSuite: validatedStringField(value, "encapsulationSuite"),
    encapsulationPublicKey: validatedStringField(
      value,
      "encapsulationPublicKey",
    ),
    encapsulationKeyFingerprint: validatedStringField(
      value,
      "encapsulationKeyFingerprint",
    ),
    firstSeenAt: validatedStringField(value, "firstSeenAt"),
    provenance: validatedProvenance(value),
  };
  if (
    pin.identityTrustDomain !== scope.identityTrustDomain ||
    pin.userId !== scope.userId
  ) {
    throw new TrustedUserIdentityPinCorruptError(
      scope,
      "primary-key scope does not match the requested pin",
    );
  }
  return pin;
}
