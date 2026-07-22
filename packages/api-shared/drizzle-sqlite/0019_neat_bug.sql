ALTER TABLE `organization_billing` ADD `checkout_attempt_id` text;--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `checkout_attempt_mode` text;--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `checkout_attempt_user_id` text;--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `checkout_attempt_seat_quantity` integer;--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `checkout_attempt_started_at` integer;--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `checkout_attempt_expires_at` integer;