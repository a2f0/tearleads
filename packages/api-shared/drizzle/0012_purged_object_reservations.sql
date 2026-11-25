CREATE TABLE "purged_object_reservations" (
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purged_organization_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purged_object_reservations_pkey" PRIMARY KEY("object_kind","object_id")
);
--> statement-breakpoint
ALTER TABLE "purged_object_reservations" ADD CONSTRAINT "purged_object_reservations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purged_object_reservations_owner_idx" ON "purged_object_reservations" USING btree ("owner_user_id");