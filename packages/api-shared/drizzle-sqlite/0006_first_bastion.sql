ALTER TABLE `blob_audit_objects` ADD `object_delete_attempted_at` integer;--> statement-breakpoint
ALTER TABLE `blob_audit_objects` ADD `organization_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `blobs` ADD `reclaim_attempted_at` integer;--> statement-breakpoint
CREATE INDEX `blobs_reclaim_attempted_at_idx` ON `blobs` (`reclaim_attempted_at`,`dereferenced_at`,`id`) WHERE "blobs"."reclaim_attempted_at" is not null and "blobs"."dereferenced_at" is not null;--> statement-breakpoint
DROP INDEX `blob_audit_objects_pending_delete_idx`;--> statement-breakpoint
CREATE INDEX `blob_audit_objects_pending_delete_idx` ON `blob_audit_objects` (`object_delete_attempted_at`,`pruned_at`,`blob_id`) WHERE "blob_audit_objects"."pruned_at" is not null and "blob_audit_objects"."object_deleted_at" is null and "blob_audit_objects"."live_storage_key" is not null;
