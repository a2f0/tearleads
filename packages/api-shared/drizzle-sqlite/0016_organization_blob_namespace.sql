ALTER TABLE `blob_stages` ADD `organization_id` text NOT NULL;--> statement-breakpoint
CREATE INDEX `blob_stages_organization_expires_at_idx` ON `blob_stages` (`organization_id`,`expires_at`,`id`);