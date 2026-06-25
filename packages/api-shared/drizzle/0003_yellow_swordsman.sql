ALTER TABLE "users" ADD COLUMN "account_status" text DEFAULT 'trialing' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_ends_at" timestamp DEFAULT (now() + interval '7 days') NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "purge_after" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "purge_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "purged_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "remote_data_epoch" integer DEFAULT 1 NOT NULL;
