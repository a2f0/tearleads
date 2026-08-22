DROP INDEX "blob_audit_objects_pending_delete_idx";--> statement-breakpoint
ALTER TABLE "blob_audit_objects" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
-- Clean-break ownerless sentinel: a retained audit row without a signed write
-- header has no recoverable tenant. The nil UUID is never a tenant identity;
-- authorization conceals these rows as not found instead of assigning them.
UPDATE "blob_audit_objects" AS "audit"
SET "organization_id" = COALESCE(
	(
		SELECT "header"."organization_id"
		FROM "blob_content_write_headers" AS "header"
		WHERE "header"."blob_id" = "audit"."blob_id"
		ORDER BY "header"."content_key_epoch" DESC, "header"."created_at" DESC
		LIMIT 1
	),
	'00000000-0000-0000-0000-000000000000'::uuid
);--> statement-breakpoint
ALTER TABLE "blob_audit_objects" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "blob_audit_objects" ADD COLUMN "object_delete_attempted_at" timestamp;--> statement-breakpoint
ALTER TABLE "blobs" ADD COLUMN "reclaim_attempted_at" timestamp;--> statement-breakpoint
CREATE INDEX "blobs_reclaim_attempted_at_idx" ON "blobs" USING btree ("reclaim_attempted_at","dereferenced_at","id") WHERE "blobs"."reclaim_attempted_at" is not null and "blobs"."dereferenced_at" is not null;--> statement-breakpoint
CREATE INDEX "blob_audit_objects_pending_delete_idx" ON "blob_audit_objects" USING btree ("object_delete_attempted_at","pruned_at","blob_id") WHERE "blob_audit_objects"."pruned_at" is not null and "blob_audit_objects"."object_deleted_at" is null and "blob_audit_objects"."live_storage_key" is not null;
