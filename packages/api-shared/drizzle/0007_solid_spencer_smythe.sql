CREATE TABLE "document_manifest_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"manifest_hash" text NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_manifest_observations_user_document_hash_idx" ON "document_manifest_observations" USING btree ("user_id","document_id","manifest_hash");--> statement-breakpoint
CREATE INDEX "document_manifest_observations_document_idx" ON "document_manifest_observations" USING btree ("document_id");