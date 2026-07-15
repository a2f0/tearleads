DROP INDEX "users_trial_expiry_idx";--> statement-breakpoint
DROP INDEX "users_purge_candidates_idx";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "account_status";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "trial_ends_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "disabled_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "purge_after";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "purge_started_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "purged_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "remote_data_epoch";