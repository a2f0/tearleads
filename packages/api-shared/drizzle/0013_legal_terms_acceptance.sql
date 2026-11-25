-- Registration records the Privacy Policy and Terms of Service revision its
-- user agreed to, and when. Both columns are nullable, so the previous Worker
-- keeps registering against this table until the new one replaces it, and
-- identities registered before this change keep no agreement, since none was
-- given. Every registration from the new Worker writes both.
ALTER TABLE "users" ADD COLUMN "legal_terms_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legal_terms_accepted_at" timestamp;