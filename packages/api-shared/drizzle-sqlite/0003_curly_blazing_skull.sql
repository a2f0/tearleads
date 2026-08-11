CREATE TABLE `principal_container_grant_projection` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`state_hash` text NOT NULL,
	`container_id` text NOT NULL,
	`access_level` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `principal_container_grant_projection_principal_idx` ON `principal_container_grant_projection` (`principal_type`,`principal_id`);--> statement-breakpoint
CREATE INDEX `principal_container_grant_projection_container_idx` ON `principal_container_grant_projection` (`container_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `principal_container_grant_projection_state_container_idx` ON `principal_container_grant_projection` (`principal_type`,`principal_id`,`state_hash`,`container_id`);--> statement-breakpoint
ALTER TABLE `principal_states` ADD `grant_root` text NOT NULL;--> statement-breakpoint
ALTER TABLE `principal_states` ADD `grant_count` integer NOT NULL;