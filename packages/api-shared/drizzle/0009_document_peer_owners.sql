CREATE TABLE "document_peer_owners" (
	"document_id" uuid NOT NULL,
	"peer_id" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_peer_owners_pkey" PRIMARY KEY("document_id","peer_id")
);
--> statement-breakpoint
-- Backfill: each committed (document, peer) is owned by the user who wrote
-- the lowest-sequence update spanning it. When that author's fingerprint
-- names no user, the peer goes to the nil id, which no user has, so nobody
-- may extend it; a later update's author never inherits it.
INSERT INTO "document_peer_owners" ("document_id", "peer_id", "owner_user_id")
SELECT DISTINCT ON ("document_update_spans"."document_id", "document_update_spans"."peer_id")
	"document_update_spans"."document_id",
	"document_update_spans"."peer_id",
	COALESCE("users"."id", '00000000-0000-0000-0000-000000000000'::uuid)
FROM "document_update_spans"
INNER JOIN "document_updates" ON "document_updates"."id" = "document_update_spans"."update_id"
LEFT JOIN "users" ON "users"."fingerprint" = "document_updates"."author_fingerprint"
ORDER BY "document_update_spans"."document_id", "document_update_spans"."peer_id", "document_updates"."sequence";
