CREATE TABLE `key_package_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`signing_key_fingerprint` text NOT NULL,
	`credential_id` text NOT NULL,
	`credential` text NOT NULL,
	`prf_salt` text NOT NULL,
	`prf_salt_version` integer DEFAULT 1 NOT NULL,
	`kdf_suite` text NOT NULL,
	`envelope` text NOT NULL,
	`backup_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `key_package_backups_credential_id_unique` ON `key_package_backups` (`credential_id`);--> statement-breakpoint
CREATE INDEX `key_package_backups_user_updated_idx` ON `key_package_backups` (`user_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `key_package_backups_fingerprint_idx` ON `key_package_backups` (`signing_key_fingerprint`);