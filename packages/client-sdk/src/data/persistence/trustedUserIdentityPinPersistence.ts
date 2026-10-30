import { and, eq, or } from "drizzle-orm";
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

/**
 * How this device came to trust a pin. `self` is the user's own local keys,
 * `link` an independently exchanged identity link, and `observed` the first
 * server answer for a user already referenced by signed state. Only `self` and
 * `link` admit a user; provenance only ever rises, and never changes the keys.
 */
export type TrustedUserIdentityPinProvenance = "self" | "link" | "observed";

const provenanceRank: Readonly<
  Record<TrustedUserIdentityPinProvenance, number>
> = { observed: 0, link: 1, self: 2 };

function isTrustedUserIdentityPinProvenance(
  value: unknown,
): value is TrustedUserIdentityPinProvenance {
  return value === "self" || value === "link" || value === "observed";
}

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

type ComparedPinField =
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

interface PinScope {
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
 * The user a signing key is already bound to in this trust domain, if any.
 * Each key has at most one such user: the reverse binding is unique.
 */
export async function loadTrustedUserIdForSigningKey(input: {
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly signingKeyFingerprint: string;
}): Promise<string | null> {
  await ensureSqlTables(input.execSql, trustedUserIdentityPinTables);
  const rows = await getClientSQLitePersistenceRuntime(input.execSql)
    .db.select({ userId: trustedUserIdentityPins.userId })
    .from(trustedUserIdentityPins)
    .where(
      and(
        eq(
          trustedUserIdentityPins.identityTrustDomain,
          input.identityTrustDomain,
        ),
        eq(
          trustedUserIdentityPins.signingKeyFingerprint,
          input.signingKeyFingerprint,
        ),
      ),
    )
    .limit(1);
  return rows[0]?.userId ?? null;
}

/**
 * One committed read answers an exact repeat of a pin that alone holds its
 * signing key and ranks at or above the candidate; anything else (first
 * contact, alias, mismatch, corrupt row, raise) returns null for the write
 * transaction. Pins are never deleted, keys never change, and provenance only
 * rises, so a match is what the transaction would return.
 */
const pins = trustedUserIdentityPins;

async function selectMatchingStoredPin(
  db: ClientSQLiteDatabase,
  pin: TrustedUserIdentityPin,
): Promise<TrustedUserIdentityPin | null> {
  const [row, other] = await db
    .select()
    .from(pins)
    .where(
      and(
        eq(pins.identityTrustDomain, pin.identityTrustDomain),
        or(
          eq(pins.userId, pin.userId),
          eq(pins.signingKeyFingerprint, pin.signingKeyFingerprint),
        ),
      ),
    )
    .limit(2);
  if (other || row?.userId !== pin.userId || validationFailure(row))
    return null;
  const stored = parseStoredPin(row, pin);
  const matches = differingPinFields(stored, pin).length === 0;
  const ranked =
    provenanceRank[pin.provenance] <= provenanceRank[stored.provenance];
  return matches && ranked ? stored : null;
}

/**
 * Atomically establishes or verifies a durable identity pin.
 *
 * The immediate transaction serializes first contact across SDK instances that
 * share the SQLite database. Conflict handling never replaces the existing
 * keys: the winning pin is re-read and every identity field is compared before
 * this function returns. When the keys match and the candidate's provenance
 * ranks higher (an identity link confirming an observed pin), only the
 * provenance is raised; it is never lowered.
 */
export async function compareOrInsertTrustedUserIdentityPin(input: {
  readonly execSql: ExecSql;
  readonly pin: TrustedUserIdentityPin;
}): Promise<TrustedUserIdentityPin> {
  const { pin } = input;
  assertCandidatePin(pin);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  return runTrustedUserIdentityPinTransaction(async () => {
    await ensureSqlTables(input.execSql, trustedUserIdentityPinTables);
    const pinned = await selectMatchingStoredPin(runtime.db, pin);
    if (pinned) return pinned;
    return runtime.transaction(
      async (tx) => {
        const aliases = await tx
          .select()
          .from(pins)
          .where(
            and(
              eq(pins.identityTrustDomain, pin.identityTrustDomain),
              eq(pins.signingKeyFingerprint, pin.signingKeyFingerprint),
            ),
          )
          .limit(1);
        const alias = aliases[0];
        if (alias && alias.userId !== pin.userId) {
          throw new TrustedUserIdentityPinMismatchError(
            parseStoredPin(alias, {
              identityTrustDomain: pin.identityTrustDomain,
              userId: alias.userId,
            }),
            pin,
            ["userId"],
          );
        }
        // Targets the primary key only: re-pinning the same user is a no-op,
        // but a write that would bind this key to a second user must fail at
        // the unique index rather than be silently skipped.
        await tx
          .insert(pins)
          .values(pin)
          .onConflictDoNothing({
            target: [pins.identityTrustDomain, pins.userId],
          })
          .run();

        const stored = await selectStoredPin(tx, pin);
        if (!stored) {
          throw new TrustedUserIdentityPinCorruptError(
            pin,
            "row is missing after compare-or-insert",
          );
        }

        const differingFields = differingPinFields(stored, pin);
        if (differingFields.length > 0) {
          throw new TrustedUserIdentityPinMismatchError(
            stored,
            pin,
            differingFields,
          );
        }
        if (
          provenanceRank[pin.provenance] <= provenanceRank[stored.provenance]
        ) {
          return stored;
        }
        await tx
          .update(pins)
          .set({ provenance: pin.provenance })
          .where(
            and(
              eq(pins.identityTrustDomain, pin.identityTrustDomain),
              eq(pins.userId, pin.userId),
            ),
          )
          .run();
        return { ...stored, provenance: pin.provenance };
      },
      { behavior: "immediate" },
    );
  });
}
