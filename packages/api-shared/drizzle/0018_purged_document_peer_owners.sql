CREATE TABLE "purged_document_peer_owners" (
	"document_id" uuid NOT NULL,
	"peer_id" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purged_end_counter" integer NOT NULL,
	"recovery_owner_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purged_document_peer_owners_pkey" PRIMARY KEY("document_id","peer_id")
);
--> statement-breakpoint
ALTER TABLE "document_peer_owners" ADD COLUMN "restorable_end_counter" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_peer_owners" ADD COLUMN "recovery_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "document_peer_owners" ADD COLUMN "allow_member_restore" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purged_document_peer_owners" ADD CONSTRAINT "purged_document_peer_owners_recovery_owner_user_id_users_id_fk" FOREIGN KEY ("recovery_owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purged_document_peer_owners_recovery_owner_idx" ON "purged_document_peer_owners" USING btree ("recovery_owner_user_id");