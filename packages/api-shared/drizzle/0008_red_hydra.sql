ALTER TABLE "organization_billing" ADD COLUMN "replacement_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "replacement_provisioning_response" jsonb;