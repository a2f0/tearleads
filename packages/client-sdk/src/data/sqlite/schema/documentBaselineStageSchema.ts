import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Durable state of an in-progress staged rotation baseline upload, at most
 * one per server document (#3238). Persisted before opening a stage and
 * before each staged segment request so a process that restarts mid-stage
 * resumes from the server-acknowledged index instead of opening a fresh
 * stage and re-uploading every segment.
 *
 * Columns:
 * - `documentId`: Server document id (primary key).
 * - `baselineId`: Client-chosen baseline id of the server stage.
 * - `contentKeyBase64`: Base64-encoded 32-byte fresh content key the stage's
 *   segments are encrypted under (client SQLite is encrypted at rest).
 * - `contentKeyCommitment`: Hex commitment of `contentKeyBase64` for
 *   `contentKeyEpoch`.
 * - `contentKeyEpoch`: Target content-key epoch opened by this rotation.
 * - `linkSetEventJson`: Serialized signed unlink `AccessEvent` when the
 *   upload belongs to an unlink; null for a sync heal.
 * - `signedAt`: Fixed ISO-8601 timestamp of the upload plan.
 * - `keyTargetsJson`: JSON array of `[containerId, containerKeyEpochId]`
 *   pairs the content key has been wrapped for, persisted so the exact
 *   target-set key-reuse fence holds across restarts.
 * - `headersSignedFor`: Signer identity (`RotationBaselineSigner.identity`)
 *   every staged header is known to be signed for, or null when unknown or
 *   re-signing.
 * - `recordsJson`: JSON array of `StagedSegmentRecord` entries in index
 *   order, written before each segment PUT so a crash with a lost answer
 *   still retains the record needed to confirm the stage on resume.
 * - `updatedAt`: ISO-8601 timestamp of the last local write.
 */
export const documentBaselineStageUploads = sqliteTable(
  "document_staged_baseline_uploads",
  {
    documentId: text("document_id").notNull(),
    baselineId: text("baseline_id").notNull(),
    contentKeyBase64: text("content_key_base64").notNull(),
    contentKeyCommitment: text("content_key_commitment").notNull(),
    contentKeyEpoch: integer("content_key_epoch").notNull(),
    linkSetEventJson: text("link_set_event_json"),
    signedAt: text("signed_at").notNull(),
    keyTargetsJson: text("key_targets_json").notNull(),
    headersSignedFor: text("headers_signed_for"),
    recordsJson: text("records_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId] })],
);

export const documentBaselineStageTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(documentBaselineStageUploads),
];
