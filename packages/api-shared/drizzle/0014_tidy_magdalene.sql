CREATE TABLE "organization_read_model_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cursor" bigint NOT NULL,
	"lane" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_read_model_heads" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "organization_read_model_heads" ("organization_id", "cursor") SELECT "id", 0 FROM "organizations";
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_read_model_changes_org_cursor_idx" ON "organization_read_model_changes" USING btree ("organization_id","cursor");
