CREATE TABLE "access_manifest_container_grant_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manifest_hash" text NOT NULL,
	"container_id" text NOT NULL,
	"access_level" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_document_sync_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_sync_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"parent_id" uuid,
	"depth" integer NOT NULL,
	"reason" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "containers" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "containers" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
WITH RECURSIVE container_tree AS (
	SELECT "id", 0 AS "depth"
	FROM "containers"
	WHERE "parent_id" IS NULL
	UNION ALL
	SELECT child."id", container_tree."depth" + 1
	FROM "containers" child
	INNER JOIN container_tree ON child."parent_id" = container_tree."id"
)
UPDATE "containers"
SET
	"depth" = container_tree."depth",
	"updated_at" = "containers"."created_at"
FROM container_tree
WHERE "containers"."id" = container_tree."id";--> statement-breakpoint
UPDATE "documents" SET "updated_at" = "created_at";--> statement-breakpoint
INSERT INTO "access_manifest_container_grant_projection" (
	"manifest_hash",
	"container_id",
	"access_level",
	"subject_type",
	"subject_id"
)
SELECT
	manifest."manifest_hash",
	manifest."object_id",
	direct_grant->>'accessLevel',
	direct_grant->>'subjectType',
	direct_grant->>'subjectId'
FROM "access_manifests" manifest
CROSS JOIN LATERAL jsonb_array_elements(
	COALESCE(manifest."state"->'directGrants', '[]'::jsonb)
) AS direct_grant
WHERE manifest."object_kind" = 'container'
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE INDEX "access_manifest_container_grant_manifest_idx" ON "access_manifest_container_grant_projection" USING btree ("manifest_hash");--> statement-breakpoint
CREATE INDEX "access_manifest_container_grant_subject_idx" ON "access_manifest_container_grant_projection" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "access_manifest_container_grant_container_idx" ON "access_manifest_container_grant_projection" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_manifest_container_grant_unique_idx" ON "access_manifest_container_grant_projection" USING btree ("manifest_hash","subject_type","subject_id","access_level");--> statement-breakpoint
CREATE UNIQUE INDEX "container_document_sync_tombstones_unique_idx" ON "container_document_sync_tombstones" USING btree ("container_id","document_id");--> statement-breakpoint
CREATE INDEX "container_document_sync_tombstones_container_updated_idx" ON "container_document_sync_tombstones" USING btree ("container_id","updated_at","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "container_sync_tombstones_user_container_idx" ON "container_sync_tombstones" USING btree ("user_id","container_id");--> statement-breakpoint
CREATE INDEX "container_sync_tombstones_user_parent_updated_idx" ON "container_sync_tombstones" USING btree ("user_id","parent_id","updated_at","container_id");--> statement-breakpoint
CREATE INDEX "containers_org_depth_updated_idx" ON "containers" USING btree ("organization_id","depth","updated_at","id");--> statement-breakpoint
CREATE INDEX "containers_parent_depth_idx" ON "containers" USING btree ("parent_id","depth");--> statement-breakpoint
CREATE INDEX "containers_parent_updated_idx" ON "containers" USING btree ("parent_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "documents_updated_at_id_idx" ON "documents" USING btree ("updated_at","id");
