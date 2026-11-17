import { and, eq, inArray, or } from "drizzle-orm";
import {
  trustedUserIdentityPins,
  trustedUserIdentityPinTables,
} from "../../sqlite/schema/trustedUserIdentityPinSchema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
import { registerClientSQLiteCommitGuard } from "../../sqlite/sqliteCommitGuards";
import {
  type ClientSQLiteDatabase,
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  assertCandidatePin,
  differingPinFields,
  type PinScope,
  parseStoredPin,
  provenanceRank,
  type TrustedUserIdentityPin,
  TrustedUserIdentityPinCorruptError,
  TrustedUserIdentityPinMismatchError,
  validationFailure,
} from "./trustedUserIdentityPinModel";
import { runTrustedUserIdentityPinTransaction } from "./trustedUserIdentityPinTransaction";

const pins = trustedUserIdentityPins;

// Each member binds one ID; the trust domain binds once per statement.
const PIN_READ_BATCH_SIZE = sqliteRowsPerStatement(1, 1);

/**
 * Durable trusted identity pins on one SQLite executor. Callers build it from
 * the executor in hand at each call; it holds no other state.
 */
export class TrustedUserIdentityPinRepository {
  private readonly execSql: ExecSql;

  constructor(execSql: ExecSql) {
    this.execSql = execSql;
  }

  async loadTrustedUserIdentityPin(
    input: PinScope,
  ): Promise<TrustedUserIdentityPin | null> {
    const scope: PinScope = {
      identityTrustDomain: input.identityTrustDomain,
      userId: input.userId,
    };
    await ensureSqlTables(this.execSql, trustedUserIdentityPinTables);
    return selectStoredPin(
      getClientSQLitePersistenceRuntime(this.execSql).db,
      scope,
    );
  }

  /** Read immutable pins together, never exposing another adapter's uncommitted rows. */
  async loadTrustedUserIdentityPins(input: {
    readonly identityTrustDomain: string;
    readonly userIds: readonly string[];
  }): Promise<ReadonlyMap<string, TrustedUserIdentityPin>> {
    const userIds = [...new Set(input.userIds)];
    if (userIds.length === 0) return new Map();
    await ensureSqlTables(this.execSql, trustedUserIdentityPinTables);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    return runTrustedUserIdentityPinTransaction(() =>
      runtime.transaction(async (tx) => {
        const loaded = new Map<string, TrustedUserIdentityPin>();
        for (
          let start = 0;
          start < userIds.length;
          start += PIN_READ_BATCH_SIZE
        ) {
          const batch = userIds.slice(start, start + PIN_READ_BATCH_SIZE);
          const rows = await tx
            .select()
            .from(pins)
            .where(
              and(
                eq(pins.identityTrustDomain, input.identityTrustDomain),
                inArray(pins.userId, batch),
              ),
            );
          for (const row of rows) {
            const pin = parseStoredPin(row, {
              identityTrustDomain: input.identityTrustDomain,
              userId: row.userId,
            });
            loaded.set(pin.userId, pin);
          }
        }
        return loaded;
      }),
    );
  }

  /**
   * The user a signing key is already bound to in this trust domain, if any.
   * Each key has at most one such user: the reverse binding is unique.
   */
  async loadTrustedUserIdForSigningKey(input: {
    readonly identityTrustDomain: string;
    readonly signingKeyFingerprint: string;
  }): Promise<string | null> {
    await ensureSqlTables(this.execSql, trustedUserIdentityPinTables);
    const rows = await getClientSQLitePersistenceRuntime(this.execSql)
      .db.select({ userId: pins.userId })
      .from(pins)
      .where(
        and(
          eq(pins.identityTrustDomain, input.identityTrustDomain),
          eq(pins.signingKeyFingerprint, input.signingKeyFingerprint),
        ),
      )
      .limit(1);
    return rows[0]?.userId ?? null;
  }

  /**
   * Atomically establishes or verifies a durable identity pin.
   *
   * The immediate transaction serializes first contact across SDK instances that
   * share the SQLite database. Conflict handling never replaces the existing
   * keys: the winning pin is re-read and every identity field is compared before
   * this method returns. When the keys match and the candidate's provenance
   * ranks higher (an identity link confirming an observed pin), only the
   * provenance is raised; it is never lowered.
   *
   * `assertCurrent` is the caller's lifetime check. It guards the write
   * transaction's COMMIT, so an operation whose account or database changed
   * while it awaited SQLite rolls its pin back instead of committing it.
   */
  async compareOrInsertTrustedUserIdentityPin(input: {
    readonly assertCurrent?: (() => void) | undefined;
    readonly pin: TrustedUserIdentityPin;
  }): Promise<TrustedUserIdentityPin> {
    const [stored] = await this.compareOrInsertTrustedUserIdentityPins({
      assertCurrent: input.assertCurrent,
      pins: [input.pin],
    });
    if (!stored)
      throw new TrustedUserIdentityPinCorruptError(input.pin, "pin not stored");
    return stored;
  }

  /**
   * Compare-or-insert a set of pins in one write transaction: a conflict on any
   * pin, or a failed `assertCurrent` at COMMIT, leaves none of them stored.
   */
  async compareOrInsertTrustedUserIdentityPins(input: {
    readonly assertCurrent?: (() => void) | undefined;
    readonly pins: readonly TrustedUserIdentityPin[];
  }): Promise<TrustedUserIdentityPin[]> {
    const { assertCurrent = () => {} } = input;
    for (const pin of input.pins) assertCandidatePin(pin);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    return runTrustedUserIdentityPinTransaction(async () => {
      await ensureSqlTables(this.execSql, trustedUserIdentityPinTables);
      // Like the write path's BEGIN, this read's BEGIN retries while any adapter
      // holds the connection's transaction, so it never sees uncommitted pins.
      const pinned = await runtime.transaction(async (tx) => {
        const matched: TrustedUserIdentityPin[] = [];
        for (const pin of input.pins) {
          const stored = await matchingPin(tx, pin);
          if (!stored) return null;
          matched.push(stored);
        }
        return matched;
      });
      if (pinned) return pinned;
      return runtime.transaction(
        async (tx) => {
          registerClientSQLiteCommitGuard(this.execSql, assertCurrent);
          const stored: TrustedUserIdentityPin[] = [];
          for (const pin of input.pins) stored.push(await writePin(tx, pin));
          return stored;
        },
        { behavior: "immediate" },
      );
    });
  }
}

async function selectStoredPin(
  db: ClientSQLiteDatabase | ClientSQLiteTransactionScope,
  scope: PinScope,
): Promise<TrustedUserIdentityPin | null> {
  const rows = await db
    .select()
    .from(pins)
    .where(
      and(
        eq(pins.identityTrustDomain, scope.identityTrustDomain),
        eq(pins.userId, scope.userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? parseStoredPin(row, scope) : null;
}

/**
 * One read answers an exact repeat of a pin that alone holds its
 * key and ranks at or above the candidate; anything else returns null for the
 * write transaction. Pins are never deleted, keys never change, and
 * provenance only rises, so a match is what the transaction would return.
 */
async function matchingPin(
  db: ClientSQLiteTransactionScope,
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
  const rank = provenanceRank;
  if (differingPinFields(stored, pin).length > 0) return null;
  return rank[pin.provenance] <= rank[stored.provenance] ? stored : null;
}

async function writePin(
  tx: ClientSQLiteTransactionScope,
  pin: TrustedUserIdentityPin,
): Promise<TrustedUserIdentityPin> {
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
    throw new TrustedUserIdentityPinMismatchError(stored, pin, differingFields);
  }
  if (provenanceRank[pin.provenance] <= provenanceRank[stored.provenance]) {
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
}
