import { desc } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema } from "./sqlTableSchema";

/** Encrypted key candidates survive disposable progress reclamation. */
export const principalKeyEnvelopeArchive = sqliteTable(
  "principal_key_envelope_archive",
  {
    organizationId: text("organization_id").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    version: integer("version").notNull(),
    envelopesJson: text("envelopes_json").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.principalType,
        table.principalId,
        table.keyFingerprint,
      ],
    }),
    index("principal_key_envelope_archive_fingerprint_idx").on(
      table.keyFingerprint,
      table.version,
    ),
  ],
);

/** Scope and recency are eviction hints, never authenticated recovery state. */
export const principalHistoryStageScopes = sqliteTable(
  "principal_history_stage_scopes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    scopeId: text("scope_id").notNull(),
    afterVersion: integer("after_version").notNull(),
    complete: integer("complete", { mode: "boolean" }).notNull(),
    touchedAt: integer("touched_at").notNull(),
  },
  (table) => [
    index("principal_history_stage_scopes_scope_idx").on(
      table.scopeId,
      table.organizationId,
      table.complete,
      desc(table.afterVersion),
      desc(table.touchedAt),
      table.id,
    ),
    index("principal_history_stage_scopes_organization_idx").on(
      table.organizationId,
    ),
    index("principal_history_stage_scopes_incomplete_idx").on(
      table.scopeId,
      table.organizationId,
      table.complete,
      desc(table.touchedAt),
      table.id,
    ),
  ],
);

export const principalHistoryRetentionTables = [
  defineSqlTableSchema(principalKeyEnvelopeArchive),
  defineSqlTableSchema(principalHistoryStageScopes),
];
