CREATE TABLE "container_builtin_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"access_level" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "container_builtin_grants_org_idx" ON "container_builtin_grants" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "container_builtin_grants_identity_idx" ON "container_builtin_grants" USING btree ("container_id","subject_type","subject_id");--> statement-breakpoint
INSERT INTO "container_builtin_grants" ("organization_id", "container_id", "access_level", "subject_type", "subject_id")
SELECT "organizations"."id", "containers"."id", 'admin', 'group', "organizations"."admin_group_id"
FROM "organizations"
INNER JOIN "containers"
	ON "containers"."organization_id" = "organizations"."id"
	AND "containers"."parent_id" IS NULL
ON CONFLICT DO NOTHING;
