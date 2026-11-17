-- Acknowledgements written before this migration hold their request, not its
-- commitment; they cannot be converted, so they are removed (#2903 P25).
DELETE FROM "principal_policy_mutation_acknowledgements";--> statement-breakpoint
ALTER TABLE "principal_policy_mutation_acknowledgements" ADD COLUMN "request_sha256" text NOT NULL;--> statement-breakpoint
ALTER TABLE "access_manifest_container_grant_projection" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "access_manifest_document_link_projection" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "access_manifest_principal_head_projection" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "blob_content_key_epochs" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "blob_content_key_epochs" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "blob_content_key_targets" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "blob_content_write_headers" DROP COLUMN "access_manifest_hash";--> statement-breakpoint
ALTER TABLE "blob_content_write_headers" DROP COLUMN "target_hash";--> statement-breakpoint
ALTER TABLE "blob_content_write_headers" DROP COLUMN "encryption_suite";--> statement-breakpoint
ALTER TABLE "container_key_wraps" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "document_content_key_epochs" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "document_content_key_epochs" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "document_content_key_targets" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "document_content_write_headers" DROP COLUMN "access_manifest_hash";--> statement-breakpoint
ALTER TABLE "document_content_write_headers" DROP COLUMN "target_hash";--> statement-breakpoint
ALTER TABLE "document_content_write_headers" DROP COLUMN "encryption_suite";--> statement-breakpoint
ALTER TABLE "document_manifest_observations" DROP COLUMN "observed_at";--> statement-breakpoint
ALTER TABLE "organization_group_tombstones" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "principal_policy_mutation_acknowledgements" DROP COLUMN "request_json";