import { and, eq } from "drizzle-orm";
import {
  trustedUserIdentityPins,
  trustedUserIdentityPinTables,
} from "../sqlite/schema";
import {
  type ClientSQLiteDatabase,
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
import {
  TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE,
  TRUSTED_USER_IDENTITY_FORMAT_VERSION,
  TRUSTED_USER_IDENTITY_SIGNING_SUITE,
} from "../trustedUserIdentity/types";
import { runTrustedUserIdentityPinTransaction } from "./trustedUserIdentityPinTransaction";

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
}

type ComparedPinField =
  | "formatVersion"
  | "signingSuite"
  | "signingPublicKey"
  | "signingKeyFingerprint"
  | "encapsulationSuite"
  | "encapsulationPublicKey"
  | "encapsulationKeyFingerprint";

interface PinDiagnostic {
  readonly formatVersion: number;
  readonly signingSuite: string;
  readonly signingKeyFingerprint: string;
  readonly encapsulationSuite: string;
  readonly encapsulationKeyFingerprint: string;
  readonly firstSeenAt: string;
}

interface PinScope {
  readonly identityTrustDomain: string;
  readonly userId: string;
}

const comparedPinFields: readonly ComparedPinField[] = [
  "formatVersion",
  "signingSuite",
  "signingPublicKey",
  "signingKeyFingerprint",
  "encapsulationSuite",
  "encapsulationPublicKey",
  "encapsulationKeyFingerprint",
];

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

function pinDiagnostic(pin: TrustedUserIdentityPin): PinDiagnostic {
  return {
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

function validationFailure(value: unknown): string | null {
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

function assertCandidatePin(pin: TrustedUserIdentityPin): void {
  const failure = validationFailure(pin);
  if (failure) {
    throw new TrustedUserIdentityPinInputError(pinScope(pin), failure);
  }
}

function parseStoredPin(
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

async function selectStoredPin(
  db: ClientSQLiteDatabase | ClientSQLiteTransactionScope,
  scope: PinScope,
): Promise<TrustedUserIdentityPin | null> {
  const rows = await db
    .select()
    .from(trustedUserIdentityPins)
    .where(
      and(
        eq(
          trustedUserIdentityPins.identityTrustDomain,
          scope.identityTrustDomain,
        ),
        eq(trustedUserIdentityPins.userId, scope.userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? parseStoredPin(row, scope) : null;
}

function differingPinFields(
  existing: TrustedUserIdentityPin,
  candidate: TrustedUserIdentityPin,
): readonly ComparedPinField[] {
  return comparedPinFields.filter(
    (field) => existing[field] !== candidate[field],
  );
}

export async function loadTrustedUserIdentityPin(input: {
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly userId: string;
}): Promise<TrustedUserIdentityPin | null> {
  const scope: PinScope = {
    identityTrustDomain: input.identityTrustDomain,
    userId: input.userId,
  };
  await ensureSqlTables(input.execSql, trustedUserIdentityPinTables);
  return selectStoredPin(
    getClientSQLitePersistenceRuntime(input.execSql).db,
    scope,
  );
}

/**
 * Atomically establishes or verifies a trust-on-first-use identity pin.
 *
 * The immediate transaction serializes first contact across SDK instances that
 * share the SQLite database. Conflict handling never replaces the existing
 * row: the winning pin is re-read and every identity field is compared before
 * this function returns.
 */
export async function compareOrInsertTrustedUserIdentityPin(input: {
  readonly execSql: ExecSql;
  readonly pin: TrustedUserIdentityPin;
}): Promise<TrustedUserIdentityPin> {
  assertCandidatePin(input.pin);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  return runTrustedUserIdentityPinTransaction(async () => {
    await ensureSqlTables(input.execSql, trustedUserIdentityPinTables);
    return runtime.transaction(
      async (tx) => {
        await tx
          .insert(trustedUserIdentityPins)
          .values(input.pin)
          .onConflictDoNothing()
          .run();

        const stored = await selectStoredPin(tx, input.pin);
        if (!stored) {
          throw new TrustedUserIdentityPinCorruptError(
            input.pin,
            "row is missing after compare-or-insert",
          );
        }

        const differingFields = differingPinFields(stored, input.pin);
        if (differingFields.length > 0) {
          throw new TrustedUserIdentityPinMismatchError(
            stored,
            input.pin,
            differingFields,
          );
        }
        return stored;
      },
      { behavior: "immediate" },
    );
  });
}
