# Local schema migrations

The client's local SQLite database moves between schema versions through
ordered, append-only steps, so an app update keeps the user's local data.
Each database records the steps it has taken in the `local_schema_migrations`
ledger table.

- [`localSchemaMigrations.ts`](localSchemaMigrations.ts) holds the step registry.
  Version 1 is the baseline: the shape the table definitions created when
  migrations began. It has no step of its own.
- [`localSchemaState.ts`](localSchemaState.ts) classifies a database as
  `fresh`, `legacy`, `behind`, `current`, `ahead`, or `diverged`, using its
  ledger and whether it already has user tables.
- [`migrateLocalSchema.ts`](migrateLocalSchema.ts) runs the pending steps.
  `ensureSqlTables` calls it before a connection's first table ensure, so
  every host migrates before any feature reads or creates a table, and no
  host has to call it at boot.

## How a database moves

| State | Meaning | Action |
| --- | --- | --- |
| `fresh` | No user tables | Record every step without running it; ensures create the current shape |
| `legacy` | User tables, no ledger | Record the baseline, then run every step |
| `behind` | Ledger older than this build | Run the newer steps |
| `current` | Ledger at this build's version | Nothing |
| `ahead` | Ledger newer than this build | Refuse: an older build must not write it |
| `diverged` | Gap or unknown step name | Refuse |

The steps, their ledger rows, and the ensure's required-column check run in
one savepoint. A step that throws, or a migrated table that still lacks a
required column, leaves the database as it was found. A database older than
the baseline still fails with "reset the local database". Another connection
that records the ledger first wins; the losing run accepts its ledger.

Browser tabs reach one database through a single worker handle. The worker's
[transaction lease](../../../../../sqlite-worker/README.md#transaction-lease)
keeps every other tab's statements out of a transaction one tab holds, but a
migration check reads the ledger before its savepoint opens, outside any
transaction. So that two tabs do not both read the ledger as behind and apply
the same steps, each connection's migration check holds the
`tearleads-local-schema-migration` Web Lock until its migration commits or
rolls back. Hosts without Web Locks have no second tab on the handle. Inside a
feature's transaction a migration would release that lock before anything is
durable, so a host that shares the database between tabs calls
`ensureLocalSchemaMigrated` before any feature runs, as the app does at boot.
Every later ensure on the connection then finds the migration done. A backup
restore holds the lock (`withLocalSchemaMigrationLock`) from BEGIN through
COMMIT and calls `migrateLocalSchema` inside that transaction, so the restored
data and its migration commit together and no tab checks the ledger in between.
Migration checks bound their wait for the Web Lock to
`LOCAL_SCHEMA_MIGRATION_LOCK_TIMEOUT_MS` (5 s) using an `AbortSignal`, failing
with `LocalSchemaMigrationLockTimeoutError` (recognized by
`isLocalSchemaMigrationLockTimeoutError`) if another tab still holds it so a
booting tab can surface a retrying state rather than hanging indefinitely.

The lock covers migration checks, not ordinary statements, but the lease
covers those: a tab that finished its own check earlier (typically one still
running the previous build after an update) waits for another tab's migration
savepoint to end instead of writing inside it. Keeping an older build's tab
working against a newer schema belongs to mixed client versions, which this
ledger does not yet handle.

## Adding a step

1. Change the Drizzle table definition under [`../schema/`](../schema/) and
   list any new column the SDK reads in the table's `requiredColumns`.
2. Append a step to `localSchemaMigrations` with the next version and a
   snake_case name. Its `up` turns the previous version's shape into the new
   one: `ALTER TABLE ... ADD COLUMN`, a backfill `UPDATE`, or for changes
   SQLite cannot alter in place, the create-copy-drop-rename rebuild.
3. Skip a table the database never created (`context.hasTable`); its ensure
   creates it later in the current shape.
4. Write the SQL for the previous shape. Do not import current table
   definitions, which keep changing after the step ships.
5. Never `BEGIN`, `COMMIT`, or change `PRAGMA foreign_keys` in a step; it
   runs inside the migration savepoint.
6. Test the step on a database written in the previous shape.

Never edit, reorder, or remove a shipped step. A correction is a new step.
The project is greenfield: a step need not preserve local data. One that
cannot run on a database holding data says in its comment that the local
database needs a reset. Signed or encrypted content cannot be rewritten by a
step; those shapes stay flag days (see
[API persistence](../../../../../../docs/developer/api-persistence.md#signed-shape-invariants)).

## Backups

A local backup copies the ledger like any other table. Restore refuses a
backup whose ledger is newer than this build or describes another history.
An older backup, or one taken before the ledger existed, restores as is; the
next table ensure migrates it. A step that changes a security-anchor table
must also teach the restore merge in
`packages/app/src/providers/db/securityAnchorBackupMerge.ts` to read the
older shape, because restore merges current anchors into the backup's rows
before migrating.
