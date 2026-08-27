CREATE TABLE `document_manifest_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_id` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`observed_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_manifest_observations_user_document_hash_idx` ON `document_manifest_observations` (`user_id`,`document_id`,`manifest_hash`);--> statement-breakpoint
CREATE INDEX `document_manifest_observations_document_idx` ON `document_manifest_observations` (`document_id`);