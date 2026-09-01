ALTER TABLE "organization_billing" ADD COLUMN "native_restore_user_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "native_restore_claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "native_restore_provisioning_response" jsonb;