PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`attribution_revision` integer DEFAULT 0 NOT NULL,
	`attribution_incarnation` text NOT NULL,
	`created_by_fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_documents`(
	`id`,
	`attribution_revision`,
	`attribution_incarnation`,
	`created_by_fingerprint`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	0,
	lower(hex(randomblob(16))),
	`created_by_fingerprint`,
	`created_at`,
	`updated_at`
FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `documents_updated_at_id_idx` ON `documents` (`updated_at`,`id`);
