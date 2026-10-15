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

export const principalHistoryRetentionTables = [
  defineSqlTableSchema(principalKeyEnvelopeArchive),
];
