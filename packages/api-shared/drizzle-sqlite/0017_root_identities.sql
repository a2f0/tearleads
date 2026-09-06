ALTER TABLE `users` ADD `is_root` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_active_at` integer;--> statement-breakpoint
CREATE INDEX `users_created_at_id_idx` ON `users` (`created_at`,`id`);