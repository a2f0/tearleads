-- A rotation baseline becomes an ordered group of ordinary update rows, its
-- segments, in place of one full-history snapshot row (#3238). Each segment
-- stores the group it belongs to and its index; the final segment also
-- stores the group's count and the signed digest of the segments before it.
-- What a group covers is read from its segments' spans, so the stored source
-- version vector goes.
--
-- This is a signed-shape flag day (see "Signed-shape invariants" in
-- docs/developer/api-persistence.md) and breaks expand-then-contract on
-- purpose: a snapshot baseline signed `checkpointKind`, `checkpointPayloadKind`
-- and `sourceVersionVector`, which no build reads any more, so such a row
-- could never authenticate again and no migration can re-sign it. The check
-- constraint below fails on a database that still holds one, and the
-- migrator's transaction rolls back; dropping the column then drops the
-- constraint with it. Deploy this only through the greenfield reset, which
-- stops old writers with the API maintenance Worker before dropping data,
-- applies this to empty tables, and only then publishes the API Worker.
ALTER TABLE "document_updates" ADD CONSTRAINT "document_updates_no_snapshot_baseline" CHECK ("baseline_source_version_vector" IS NULL);--> statement-breakpoint
DROP INDEX "document_updates_baseline_idx";--> statement-breakpoint
ALTER TABLE "document_updates" ADD COLUMN "baseline_id" uuid;--> statement-breakpoint
ALTER TABLE "document_updates" ADD COLUMN "baseline_segment_index" integer;--> statement-breakpoint
ALTER TABLE "document_updates" ADD COLUMN "baseline_segment_count" integer;--> statement-breakpoint
ALTER TABLE "document_updates" ADD COLUMN "baseline_segments_digest" text;--> statement-breakpoint
CREATE UNIQUE INDEX "document_updates_baseline_segment_idx" ON "document_updates" USING btree ("baseline_id","baseline_segment_index") WHERE "document_updates"."baseline_id" is not null;--> statement-breakpoint
CREATE INDEX "document_updates_baseline_idx" ON "document_updates" USING btree ("document_id","sequence") WHERE "document_updates"."baseline_id" is not null;--> statement-breakpoint
ALTER TABLE "document_updates" DROP COLUMN "baseline_source_version_vector";
