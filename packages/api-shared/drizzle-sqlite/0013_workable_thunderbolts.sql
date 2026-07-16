ALTER TABLE `blob_stages` ADD `storage_key` text NOT NULL;--> statement-breakpoint
ALTER TABLE `blob_stages` ADD `upload_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `blob_stages` ADD `completed_at` integer;--> statement-breakpoint
ALTER TABLE `blob_stages` DROP COLUMN `encrypted_bytes`;--> statement-breakpoint
ALTER TABLE `blobs` DROP COLUMN `encrypted_bytes`;