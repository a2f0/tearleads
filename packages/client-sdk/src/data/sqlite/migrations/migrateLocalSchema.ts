import {
  type ExecSql,
  hasCompletedConnectionOnce,
  markCompletedConnectionOnce,
  runSerializedSqlMutation,
} from "../sqlExec";
import {
  assertLocalSchemaMigrations,
  type LocalSchemaMigration,
  type LocalSchemaMigrationContext,
  type LocalSchemaStep,
  localSchemaMigrations,
} from "./localSchemaMigrations";
import {
  classifyLocalSchema,
  type LocalSchemaState,
  localSchemaStateError,
  parseLocalSchemaLedger,
} from "./localSchemaState";

/** The ledger table; a local backup carries it like any other table. */
export const LOCAL_SCHEMA_MIGRATIONS_TABLE = "local_schema_migrations";

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS "${LOCAL_SCHEMA_MIGRATIONS_TABLE}" ("version" INTEGER PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "applied_at" INTEGER NOT NULL)`;
const SAVEPOINT = "local_schema_migration";
const ENSURE_KEY = "local-schema-migrations";

type VerifyLocalSchema = (execSql: ExecSql) => Promise<void>;

interface MigrateLocalSchemaOptions {
  readonly migrations?: ReadonlyArray<LocalSchemaMigration>;
  readonly now?: () => number;
  /**
   * Runs after the steps, before they commit: a throw undoes every step and
   * ledger row, so a refused database is left exactly as it was found.
   */
  readonly verify?: VerifyLocalSchema;
}

// Whether the ledger exists and whether any other user table does: a
// database with neither is fresh, one with only the latter predates the
// ledger. A database that already has the ledger costs one more read.
async function readLocalSchema(execSql: ExecSql): Promise<{
  readonly ledger: LocalSchemaStep[] | null;
  readonly hasUserTables: boolean;
}> {
  const [catalog] = await execSql(
    `SELECT
       coalesce(sum(lower(name) = ?), 0) AS ledger_tables,
       coalesce(sum(lower(name) <> ?), 0) AS user_tables
     FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    [LOCAL_SCHEMA_MIGRATIONS_TABLE, LOCAL_SCHEMA_MIGRATIONS_TABLE],
  );
  const { ledger_tables: ledgerTables, user_tables: userTables } =
    catalog ?? {};
  const rows =
    Number(ledgerTables) > 0
      ? await execSql(
          `SELECT version, name FROM "${LOCAL_SCHEMA_MIGRATIONS_TABLE}"`,
        )
      : [];
  return {
    hasUserTables: Number(userTables) > 0,
    ledger: parseLocalSchemaLedger(rows),
  };
}

// Inlined rather than bound, so one worker message carries the ledger DDL and
// its rows: versions are integers and step names are checked snake_case.
function recordStepsSql(
  steps: ReadonlyArray<LocalSchemaStep>,
  appliedAt: number,
): string[] {
  if (steps.length === 0) return [];
  const values = steps.map(({ name, version }) => {
    if (!/^[a-z0-9_]+$/.test(name) || !Number.isSafeInteger(version)) {
      throw new Error(`Local schema step ${version} cannot be recorded`);
    }
    return `(${version}, '${name}', ${Math.trunc(appliedAt)})`;
  });
  return [
    `INSERT INTO "${LOCAL_SCHEMA_MIGRATIONS_TABLE}" (version, name, applied_at) VALUES ${values.join(", ")}`,
  ];
}

function migrationContext(execSql: ExecSql): LocalSchemaMigrationContext {
  return {
    hasTable: async (name) =>
      (
        await execSql(
          "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
          [name],
        )
      ).length > 0,
  };
}

// Runs the pending steps in a savepoint: a throw from a step or from `verify`
// rolls back every step and ledger row of this run.
async function applyPendingSteps(
  execSql: ExecSql,
  state: Extract<LocalSchemaState, { status: "legacy" | "behind" }>,
  now: () => number,
  verify: VerifyLocalSchema,
): Promise<void> {
  const baseline = state.status === "legacy" ? state.record : [];
  try {
    // Inside the try: a conflicting baseline row (another connection recorded
    // it first) must still roll back and release this savepoint.
    await execSql(
      [
        `SAVEPOINT ${SAVEPOINT}`,
        LEDGER_DDL,
        ...recordStepsSql(baseline, now()),
      ].join(";\n"),
    );
    const context = migrationContext(execSql);
    for (const migration of state.pending) {
      await migration.up(execSql, context);
      await execSql(recordStepsSql([migration], now()).join(""));
    }
    await verify(execSql);
    await execSql(`RELEASE SAVEPOINT ${SAVEPOINT}`);
  } catch (error) {
    await execSql(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`).catch(() => undefined);
    await execSql(`RELEASE SAVEPOINT ${SAVEPOINT}`).catch(() => undefined);
    throw error;
  }
}

async function applyLocalSchemaState(
  execSql: ExecSql,
  state: LocalSchemaState,
  now: () => number,
  verify: VerifyLocalSchema,
): Promise<void> {
  if (state.status === "fresh") {
    // No user tables yet, so there is nothing to roll back and `verify` has
    // no table to refuse: the ledger and its rows travel in one message.
    await execSql(
      [LEDGER_DDL, ...recordStepsSql(state.record, now())].join(";\n"),
    );
    await verify(execSql);
    return;
  }
  if (state.status === "legacy" || state.status === "behind") {
    await applyPendingSteps(execSql, state, now, verify);
  }
}

const CROSS_TAB_MIGRATION_LOCK = "tearleads-local-schema-migration";

function webLocks(): LockManager | null {
  if (typeof navigator !== "object" || navigator === null) return null;
  const { locks } = navigator;
  return typeof locks?.request === "function" ? locks : null;
}

// Browser tabs share one worker handle but not their mutation queues, so a
// tab could read another tab's uncommitted ledger as current and write rows
// that tab's rollback then deletes. A Web Lock makes every connection's
// migration check wait until any other tab's migration commits or rolls back.
// Hosts without Web Locks have no second tab on the handle.
function withCrossTabMigrationLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  return locks ? locks.request(CROSS_TAB_MIGRATION_LOCK, run) : run();
}

/**
 * Brings the local database to this build's schema version. Pending steps,
 * their ledger rows, and `verify` commit together or not at all; a database
 * written by a newer build, or with a foreign history, is refused before any
 * change. Another connection that migrates first wins: a run that fails
 * because the ledger is already complete accepts it.
 */
export async function migrateLocalSchema(
  execSql: ExecSql,
  options: MigrateLocalSchemaOptions = {},
): Promise<LocalSchemaState> {
  const migrations = options.migrations ?? localSchemaMigrations;
  const now = options.now ?? Date.now;
  const verify = options.verify ?? (async () => {});
  assertLocalSchemaMigrations(migrations);
  return withCrossTabMigrationLock(() =>
    runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const read = async () =>
        classifyLocalSchema({
          ...(await readLocalSchema(lockedExecSql)),
          migrations,
        });
      const state = await read();
      const error = localSchemaStateError(state);
      if (error) throw error;
      if (state.status === "current") {
        await verify(lockedExecSql);
        return state;
      }
      try {
        await applyLocalSchemaState(lockedExecSql, state, now, verify);
        return state;
      } catch (applyError) {
        const settled = await read().catch(() => null);
        if (settled?.status !== "current") throw applyError;
        await verify(lockedExecSql);
        return settled;
      }
    }),
  );
}

/**
 * Runs {@link migrateLocalSchema} once per connection, then `verify` on every
 * call. Every table ensure calls it first, so no feature reads or creates a
 * table before the database reaches this build's version, and an ensure that
 * refuses the migrated shape leaves no ledger or step behind.
 * `resetConnectionSchemaMemo` (a backup restore) makes the next ensure
 * migrate again.
 */
export async function ensureLocalSchemaMigrated(
  execSql: ExecSql,
  verify: VerifyLocalSchema = async () => {},
): Promise<void> {
  if (hasCompletedConnectionOnce(execSql, ENSURE_KEY)) {
    await verify(execSql);
    return;
  }
  await migrateLocalSchema(execSql, { verify });
  markCompletedConnectionOnce(execSql, ENSURE_KEY);
}

/**
 * Refuses ledger rows (a backup's copy of the ledger table) that this build
 * could not open: a newer version or a foreign history. No rows means the
 * backup predates the ledger and restores at the baseline.
 */
export function assertRestorableLocalSchemaLedger(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
): void {
  const error = localSchemaStateError(
    classifyLocalSchema({
      hasUserTables: true,
      ledger: parseLocalSchemaLedger(rows),
      migrations: localSchemaMigrations,
    }),
  );
  if (error) throw error;
}
