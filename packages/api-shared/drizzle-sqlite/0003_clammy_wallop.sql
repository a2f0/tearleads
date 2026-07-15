ALTER TABLE `users` ADD `account_status` text DEFAULT 'trialing' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `trial_ends_at` integer DEFAULT (cast((julianday('now', '+7 days') - 2440587.5)*86400000 as integer)) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `purge_after` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `purge_started_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `purged_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `remote_data_epoch` integer DEFAULT 1 NOT NULL;
