import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema } from "./sqlTableSchema";

/**
 * Append-only local evidence that an SDK trust-boundary verification failed.
 *
 * Error messages and decrypted values are deliberately excluded. Callers may
 * attach only hashes that were already part of the verified protocol object.
 * Remote-state resets do not include this table, so an API rollback cannot
 * erase the client's record of having detected it.
 */
export const securityIncidents = sqliteTable(
  "security_incidents",
  {
    id: text("id").primaryKey(),
    trustDomain: text("trust_domain"),
    code: text("code").notNull(),
    operation: text("operation").notNull(),
    objectKind: text("object_kind").notNull(),
    objectId: text("object_id"),
    organizationId: text("organization_id"),
    evidenceHashes: text("evidence_hashes").notNull(),
    detectedAt: text("detected_at").notNull(),
  },
  (table) => [index("security_incidents_detected_at_idx").on(table.detectedAt)],
);

export const securityIncidentTable = defineSqlTableSchema(securityIncidents);
