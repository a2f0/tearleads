CREATE TABLE `organization_read_model_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`cursor` numeric NOT NULL,
	`lane` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_read_model_changes_org_cursor_idx` ON `organization_read_model_changes` (`organization_id`,`cursor`);--> statement-breakpoint
CREATE TABLE `organization_read_model_heads` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`cursor` numeric DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `organization_read_model_heads` (`organization_id`, `cursor`) SELECT `id`, 0 FROM `organizations`;
