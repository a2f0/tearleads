ALTER TABLE "revenuecat_webhook_events" ADD COLUMN "source_organization_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_billing_provider_subscription_idx" ON "organization_billing" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE INDEX "revenuecat_webhook_events_source_org_idx" ON "revenuecat_webhook_events" USING btree ("source_organization_id");