-- A rotation baseline too large for one request is staged first (#3238): its
-- writer uploads every segment but the final one to
-- document_baseline_segments under an open document_baseline_stages row, and
-- the unlink or sync that rotates commits them by reference. The commit
-- inserts one document_updates row per staged segment with a null
-- encrypted_data, and readers take the payload from the staged row by update
-- id, so no ciphertext is copied under the document head lock. The check
-- constraint keeps a null payload to baseline segments.
--
-- The unique index on a group's segments gains document_id: a baseline id is
-- its writer's choice, so two documents may use the same one.
--
-- The tables are new and the column only loses a constraint, so the previous
-- Worker keeps working against this schema until a staged baseline commits;
-- it would then read a null payload, so deploy the Worker with the schema.
CREATE TABLE "document_baseline_segment_spans" (
	"document_id" uuid NOT NULL,
	"baseline_id" uuid NOT NULL,
	"update_id" uuid NOT NULL,
	"peer_id" text NOT NULL,
	"start_counter" integer NOT NULL,
	"end_counter" integer NOT NULL,
	CONSTRAINT "document_baseline_segment_spans_pkey" PRIMARY KEY("update_id","peer_id")
);
--> statement-breakpoint
CREATE TABLE "document_baseline_segments" (
	"update_id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"baseline_id" uuid NOT NULL,
	"segment_index" integer NOT NULL,
	"encrypted_data" text NOT NULL,
	"byte_length" integer NOT NULL,
	"partial_start_version_vector" text NOT NULL,
	"partial_end_version_vector" text NOT NULL,
	"dependency_version_vector" text NOT NULL,
	"plaintext_hash" text NOT NULL,
	"header" jsonb NOT NULL,
	"header_hash" text NOT NULL,
	"authorization_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_baseline_stages" (
	"document_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"content_key_epoch" integer NOT NULL,
	"content_key_commitment" text NOT NULL,
	"next_segment_index" integer DEFAULT 0 NOT NULL,
	"segments_digest" text NOT NULL,
	"staged_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "document_baseline_stages_pkey" PRIMARY KEY("document_id","id")
);
--> statement-breakpoint
DROP INDEX "document_updates_baseline_segment_idx";--> statement-breakpoint
ALTER TABLE "document_updates" ALTER COLUMN "encrypted_data" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "document_baseline_segment_spans_frontier_idx" ON "document_baseline_segment_spans" USING btree ("document_id","baseline_id","peer_id","end_counter");--> statement-breakpoint
CREATE UNIQUE INDEX "document_baseline_segments_stage_index_idx" ON "document_baseline_segments" USING btree ("document_id","baseline_id","segment_index");--> statement-breakpoint
CREATE UNIQUE INDEX "document_baseline_stages_owner_idx" ON "document_baseline_stages" USING btree ("document_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "document_baseline_stages_expires_at_idx" ON "document_baseline_stages" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_updates_baseline_segment_idx" ON "document_updates" USING btree ("document_id","baseline_id","baseline_segment_index") WHERE "document_updates"."baseline_id" is not null;--> statement-breakpoint
ALTER TABLE "document_updates" ADD CONSTRAINT "document_updates_payload_by_reference" CHECK ("document_updates"."encrypted_data" is not null or "document_updates"."baseline_id" is not null);