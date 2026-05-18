ALTER TABLE "document_updates" ADD COLUMN "byte_length" integer;--> statement-breakpoint
UPDATE "document_updates" SET "byte_length" = octet_length("encrypted_data");--> statement-breakpoint
ALTER TABLE "document_updates" ALTER COLUMN "byte_length" SET NOT NULL;
