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

const DIRECTORY_USERS_TABLE = "organization_read_model_directory_users";

/**
 * Ordered and append-only: version 2 first, each one after the last. Never
 * edit or remove a shipped step; a correction is a new step.
 */
export const localSchemaMigrations: ReadonlyArray<LocalSchemaMigration> = [
  {
    // Directory rows carry key fingerprints only; public keys come from the
    // trusted identity store. Neither column is indexed or constrained.
    name: "drop_directory_user_public_keys",
    up: async (execSql, context) => {
      if (!(await context.hasTable(DIRECTORY_USERS_TABLE))) return;
      for (const column of ["signing_public_key", "encapsulation_public_key"]) {
        await execSql(
          `ALTER TABLE "${DIRECTORY_USERS_TABLE}" DROP COLUMN "${column}"`,
        );
      }
    },
    version: 2,
  },
  {
    // No reader ever used a recorded failure's HTTP status; the message and
    // attempt time explain a blocked document. The column is unindexed. A
    // documents table without it (never created, or not this SDK's table in a
    // restored backup) has nothing to drop.
    name: "drop_document_sync_failure_status",
    up: async (execSql) => {
      const column = await execSql(
        "SELECT name FROM pragma_table_info('documents') WHERE name = 'sync_failure_status'",
      );
      if (column.length === 0) return;
      await execSql(
        'ALTER TABLE "documents" DROP COLUMN "sync_failure_status"',
      );
    },
    version: 3,
  },
  {
    name: "replay_commit_ordered_discovery",
    up: async (execSql, context) => {
      if (!(await context.hasTable("container_sync_watermarks"))) return;
      // Older SDKs could checkpoint a publication before reconciling an
      // unlink or a restored subtree. Legacy UUID cursors already replay.
      await execSql(
        "ALTER TABLE container_sync_watermarks ADD COLUMN cursor_format INTEGER NOT NULL DEFAULT 1",
      );
    },
    version: 4,
  },
  {
    name: "project_document_attachment_names",
    up: async (execSql, context) => {
      if (await context.hasTable("document_projection_text")) {
        await execSql(
          "ALTER TABLE document_projection_text ADD COLUMN attachment_names TEXT",
        );
      }
    },
    version: 5,
  },
  {
    name: "mark_requeued_pending_attachments",
    up: async (execSql, context) => {
      if (await context.hasTable("document_pending_attachments")) {
        await execSql(
          "ALTER TABLE document_pending_attachments ADD COLUMN requeued INTEGER NOT NULL DEFAULT 0",
        );
      }
    },
    version: 6,
  },
  {
    // Every verdict is reached under the content key its update's signed
    // envelope commits to, so neither a void row nor a Loro read window
    // names the key it was read with. None of these columns is indexed or
    // part of a key. No step creates either table: each one's ensure does,
    // after migrating. A database at version 6 from before a table (step 6
    // shipped a day before the void table, two before the window table), a
    // pre-ledger database, or a backup any of them took lacks it, and
    // failing here would leave that database unopenable.
    name: "drop_document_sync_key_columns",
    up: async (execSql) => {
      for (const table of ["document_void_updates", "document_loro_windows"]) {
        const columns = new Set(
          (await execSql(`SELECT name FROM pragma_table_info('${table}')`)).map(
            ({ name }) => String(name),
          ),
        );
        for (const column of ["content_key_epoch", "key_fingerprint"]) {
          if (!columns.has(column)) continue;
          await execSql(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
        }
      }
    },
    version: 7,
  },
  {
    // A record moved to a fresh writer peer keeps the salt that derives it,
    // so a reload writes on that peer and not the refused one.
    name: "add_document_peer_salt",
    up: async (execSql, context) => {
      if (await context.hasTable("documents")) {
        await execSql('ALTER TABLE "documents" ADD COLUMN "peer_salt" TEXT');
      }
    },
    version: 8,
  },
  {
    // A container listing advertises its metadata document's update count,
    // which a processed cursor covers, instead of a version vector. A cursor
    // recorded before its pull's count is known covers no count. An owed
    // read keeps its debt at a count of 1, which only a completed pull of a
    // document with an update settles, so no debt is lost.
    name: "count_metadata_listing_updates",
    up: async (execSql, context) => {
      if (await context.hasTable("document_sync_progress")) {
        await execSql(
          "ALTER TABLE document_sync_progress ADD COLUMN through_update_count INTEGER",
        );
      }
      if (await context.hasTable("container_metadata_revalidations")) {
        await execSql(
          "ALTER TABLE container_metadata_revalidations ADD COLUMN advertised_update_count INTEGER NOT NULL DEFAULT 1",
        );
        await execSql(
          "ALTER TABLE container_metadata_revalidations DROP COLUMN advertised_version_vector",
        );
      }
    },
    version: 9,
  },
];

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
