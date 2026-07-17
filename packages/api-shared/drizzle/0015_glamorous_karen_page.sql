CREATE TABLE "organization_group_tombstones" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "organization_group_tombstones_org_idx" ON "organization_group_tombstones" USING btree ("organization_id","deleted_at");