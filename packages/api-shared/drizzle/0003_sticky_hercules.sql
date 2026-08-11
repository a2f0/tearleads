-- Flag-day migration: principal state grant commitments are signed and cannot
-- be backfilled. Deploy only after dropping the pre-grant-index database.
CREATE TABLE "principal_container_grant_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"container_id" uuid NOT NULL,
	"access_level" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "principal_states" ADD COLUMN "grant_root" text NOT NULL;--> statement-breakpoint
ALTER TABLE "principal_states" ADD COLUMN "grant_count" integer NOT NULL;--> statement-breakpoint
CREATE INDEX "principal_container_grant_projection_principal_idx" ON "principal_container_grant_projection" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "principal_container_grant_projection_container_idx" ON "principal_container_grant_projection" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_container_grant_projection_state_container_idx" ON "principal_container_grant_projection" USING btree ("principal_type","principal_id","state_hash","container_id");
