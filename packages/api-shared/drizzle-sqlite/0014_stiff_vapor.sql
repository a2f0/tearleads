CREATE TABLE `document_inline_rekey_commits` (
	`id` text PRIMARY KEY NOT NULL,
	`commit_id` text NOT NULL,
	`document_id` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_inline_rekey_commits_document_commit_idx` ON `document_inline_rekey_commits` (`document_id`,`commit_id`);