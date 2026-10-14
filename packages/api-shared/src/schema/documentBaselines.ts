import { index, pgTable, text, uuid } from "./columns";

/**
 * Marks which retained document updates are rotation baselines.
 *
 * A sync or unlink that commits an update carrying `checkpointKind` records
 * the update here in the same transaction. The row repeats the update's signed
 * checkpoint metadata so the baseline redirect, the sync response, and edit
 * attribution can find baselines without parsing write headers. Readers that
 * serve a baseline recompute the signed metadata hash from these columns and
 * the update row, so a tampered row fails closed rather than redirecting.
 *
 * Columns:
 * - `baselineUpdateId`: Primary key; the `document_updates.id` of the
 *   baseline update.
 * - `documentId`: Document the baseline belongs to.
 * - `checkpointKind`: Checkpoint kind from the signed update metadata.
 * - `sourceVersionVector`: Loro source version vector the baseline declares
 *   it covers, from the signed update metadata.
 *
 * Indexes:
 * - `(documentId)` supports the per-document baseline redirect and purge.
 */
export const documentBaselines = pgTable(
  "document_baselines",
  {
    baselineUpdateId: uuid("baseline_update_id").primaryKey(),
    documentId: uuid("document_id").notNull(),
    checkpointKind: text("checkpoint_kind").notNull(),
    sourceVersionVector: text("source_version_vector").notNull(),
  },
  (table) => [index("document_baselines_document_idx").on(table.documentId)],
);
