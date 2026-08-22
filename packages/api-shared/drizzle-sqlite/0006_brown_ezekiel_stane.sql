CREATE TABLE `__new_blob_audit_objects` (
	`blob_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_length` integer NOT NULL,
	`live_storage_key` text,
	`retention_mode` text NOT NULL,
	`historical_bytes_retained` integer NOT NULL,
	`pruned_at` integer,
	`object_delete_attempted_at` integer,
	`object_deleted_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_blob_audit_objects`(
	`blob_id`,
	`organization_id`,
	`sha256`,
	`byte_length`,
	`live_storage_key`,
	`retention_mode`,
	`historical_bytes_retained`,
	`pruned_at`,
	`object_delete_attempted_at`,
	`object_deleted_at`,
	`created_at`
)
SELECT
	`audit`.`blob_id`,
	coalesce(
		(
			SELECT `header`.`organization_id`
			FROM `blob_content_write_headers` AS `header`
			WHERE `header`.`blob_id` = `audit`.`blob_id`
			ORDER BY `header`.`content_key_epoch` DESC, `header`.`created_at` DESC
			LIMIT 1
		),
		'00000000-0000-0000-0000-000000000000'
	),
	`audit`.`sha256`,
	`audit`.`byte_length`,
	`audit`.`live_storage_key`,
	`audit`.`retention_mode`,
	`audit`.`historical_bytes_retained`,
	`audit`.`pruned_at`,
	NULL,
	`audit`.`object_deleted_at`,
	`audit`.`created_at`
FROM `blob_audit_objects` AS `audit`;--> statement-breakpoint
DROP TABLE `blob_audit_objects`;--> statement-breakpoint
ALTER TABLE `__new_blob_audit_objects` RENAME TO `blob_audit_objects`;--> statement-breakpoint
CREATE INDEX `blob_audit_objects_pending_delete_idx` ON `blob_audit_objects` (`object_delete_attempted_at`,`pruned_at`,`blob_id`) WHERE "blob_audit_objects"."pruned_at" is not null and "blob_audit_objects"."object_deleted_at" is null and "blob_audit_objects"."live_storage_key" is not null;--> statement-breakpoint
ALTER TABLE `blobs` ADD `reclaim_attempted_at` integer;--> statement-breakpoint
CREATE INDEX `blobs_reclaim_attempted_at_idx` ON `blobs` (`reclaim_attempted_at`,`dereferenced_at`,`id`) WHERE "blobs"."reclaim_attempted_at" is not null and "blobs"."dereferenced_at" is not null;
