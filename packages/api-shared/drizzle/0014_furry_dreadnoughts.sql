CREATE TABLE "document_inline_rekey_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commit_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_inline_rekey_commits_document_commit_idx" ON "document_inline_rekey_commits" USING btree ("document_id","commit_id");