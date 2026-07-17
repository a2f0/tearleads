CREATE TABLE `organization_group_tombstones` (
	`group_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`deleted_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organization_group_tombstones_org_idx` ON `organization_group_tombstones` (`organization_id`,`deleted_at`);