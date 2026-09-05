PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_blob_content_write_headers` (
	`record_id` text PRIMARY KEY NOT NULL,
	`blob_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`content_key_epoch` integer NOT NULL,
	`access_manifest_hash` text NOT NULL,
	`target_hash` text NOT NULL,
	`encryption_suite` text NOT NULL,
	`content_record_id` text NOT NULL,
	`nonce_domain_hash` text NOT NULL,
	`header_hash` text NOT NULL,
	`header` text NOT NULL,
	`authorization` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_blob_content_write_headers`("record_id", "blob_id", "organization_id", "content_key_epoch", "access_manifest_hash", "target_hash", "encryption_suite", "content_record_id", "nonce_domain_hash", "header_hash", "header", "authorization", "created_at") SELECT "record_id", "blob_id", "organization_id", "content_key_epoch", "access_manifest_hash", "target_hash", "encryption_suite", "content_record_id", "nonce_domain_hash", "header_hash", "header", "authorization", "created_at" FROM `blob_content_write_headers`;--> statement-breakpoint
DROP TABLE `blob_content_write_headers`;--> statement-breakpoint
ALTER TABLE `__new_blob_content_write_headers` RENAME TO `blob_content_write_headers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `blob_content_write_headers_blob_epoch_idx` ON `blob_content_write_headers` (`blob_id`,`content_key_epoch`);--> statement-breakpoint
CREATE INDEX `blob_content_write_headers_organization_blob_idx` ON `blob_content_write_headers` (`organization_id`,`blob_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `blob_content_write_headers_header_hash_idx` ON `blob_content_write_headers` (`header_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `blob_content_write_headers_content_record_idx` ON `blob_content_write_headers` (`blob_id`,`content_key_epoch`,`content_record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `blob_content_write_headers_nonce_domain_idx` ON `blob_content_write_headers` (`blob_id`,`content_key_epoch`,`nonce_domain_hash`);--> statement-breakpoint
CREATE TABLE `__new_document_content_write_headers` (
	`update_id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`content_key_epoch` integer NOT NULL,
	`access_manifest_hash` text NOT NULL,
	`target_hash` text NOT NULL,
	`encryption_suite` text NOT NULL,
	`content_record_id` text NOT NULL,
	`nonce_domain_hash` text NOT NULL,
	`header_hash` text NOT NULL,
	`header` text NOT NULL,
	`authorization_targets` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_document_content_write_headers`("update_id", "document_id", "organization_id", "content_key_epoch", "access_manifest_hash", "target_hash", "encryption_suite", "content_record_id", "nonce_domain_hash", "header_hash", "header", "authorization_targets", "created_at") SELECT "update_id", "document_id", "organization_id", "content_key_epoch", "access_manifest_hash", "target_hash", "encryption_suite", "content_record_id", "nonce_domain_hash", "header_hash", "header", "authorization_targets", "created_at" FROM `document_content_write_headers`;--> statement-breakpoint
DROP TABLE `document_content_write_headers`;--> statement-breakpoint
ALTER TABLE `__new_document_content_write_headers` RENAME TO `document_content_write_headers`;--> statement-breakpoint
CREATE INDEX `document_content_write_headers_document_epoch_idx` ON `document_content_write_headers` (`document_id`,`content_key_epoch`);--> statement-breakpoint
CREATE INDEX `document_content_write_headers_organization_update_idx` ON `document_content_write_headers` (`organization_id`,`update_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_content_write_headers_header_hash_idx` ON `document_content_write_headers` (`header_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_content_write_headers_content_record_idx` ON `document_content_write_headers` (`document_id`,`content_key_epoch`,`content_record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_content_write_headers_nonce_domain_idx` ON `document_content_write_headers` (`document_id`,`content_key_epoch`,`nonce_domain_hash`);