CREATE TABLE "key_package_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"signing_key_fingerprint" text NOT NULL,
	"credential_id" text NOT NULL,
	"credential" jsonb NOT NULL,
	"prf_salt" text NOT NULL,
	"prf_salt_version" integer DEFAULT 1 NOT NULL,
	"kdf_suite" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"backup_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "key_package_backups_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE INDEX "key_package_backups_user_updated_idx" ON "key_package_backups" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "key_package_backups_fingerprint_idx" ON "key_package_backups" USING btree ("signing_key_fingerprint");