ALTER TABLE "blob_stages" ADD COLUMN "storage_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "blob_stages" ADD COLUMN "upload_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "blob_stages" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "blob_stages" DROP COLUMN "encrypted_bytes";--> statement-breakpoint
ALTER TABLE "blobs" DROP COLUMN "encrypted_bytes";