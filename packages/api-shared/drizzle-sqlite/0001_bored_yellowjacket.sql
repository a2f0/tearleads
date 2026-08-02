ALTER TABLE `revenuecat_webhook_events` ADD `source_organization_id` text;--> statement-breakpoint
CREATE INDEX `revenuecat_webhook_events_source_org_idx` ON `revenuecat_webhook_events` (`source_organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_provider_subscription_idx` ON `organization_billing` (`provider_subscription_id`);