DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM "organizations") THEN
		RAISE EXCEPTION 'member_group_id migration requires an empty organizations table';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "member_group_id" uuid NOT NULL;
