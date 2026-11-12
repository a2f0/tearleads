import type { ExecSql } from "../sqlExec";

export interface LocalSchemaMigrationContext {
  /**
   * Whether a table exists. Features create their tables lazily, so a
   * migration must skip a table this database never created: the table's
   * ensure creates it later in the current shape.
   */
  hasTable(name: string): Promise<boolean>;
}

export interface LocalSchemaStep {
  readonly version: number;
  readonly name: string;
}

export interface LocalSchemaMigration extends LocalSchemaStep {
  /**
   * Upgrades the local database from `version - 1` to `version`. It runs on
   * the locked executor inside the migration savepoint, so it must not BEGIN,
   * COMMIT, or change `PRAGMA foreign_keys`. Write it against the shape at
   * `version - 1`, never by importing current table definitions.
   */
  up(execSql: ExecSql, context: LocalSchemaMigrationContext): Promise<void>;
}

/**
 * Version 1 is the shape the SDK's table definitions created when local
 * migrations began. It has no steps: a database from before the ledger is
 * recorded at this version, and an older shape still fails its tables'
 * required-column check.
 */
export const LOCAL_SCHEMA_BASELINE: LocalSchemaStep = {
  name: "baseline",
  version: 1,
};

/**
 * Ordered and append-only: version 2 first, each one after the last. Never
 * edit or remove a shipped step; a correction is a new step.
 */
export const localSchemaMigrations: ReadonlyArray<LocalSchemaMigration> = [];

const STEP_NAME_PATTERN = /^[a-z0-9_]+$/;

/** Rejects a registry whose versions are not consecutive from 2. */
export function assertLocalSchemaMigrations(
  migrations: ReadonlyArray<LocalSchemaMigration>,
): void {
  for (const [index, migration] of migrations.entries()) {
    const expected = LOCAL_SCHEMA_BASELINE.version + index + 1;
    if (migration.version !== expected) {
      throw new Error(
        `Local schema migration ${migration.name} has version ${migration.version}; expected ${expected}`,
      );
    }
    if (!STEP_NAME_PATTERN.test(migration.name)) {
      throw new Error(
        `Local schema migration ${migration.version} needs a snake_case name`,
      );
    }
  }
}

/** The steps a database at the newest version has recorded, in order. */
export function localSchemaSteps(
  migrations: ReadonlyArray<LocalSchemaMigration>,
): ReadonlyArray<LocalSchemaStep> {
  return [
    LOCAL_SCHEMA_BASELINE,
    ...migrations.map(({ name, version }) => ({ name, version })),
  ];
}
