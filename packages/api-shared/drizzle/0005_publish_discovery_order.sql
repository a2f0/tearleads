-- PostgreSQL upgrades fill rows in short transactions and build indexes
-- concurrently before the journaled migration. Empty installations and
-- single-writer PGlite use the same schema directly.
DO $$ BEGIN
  LOCK TABLE public.documents, public.containers, public.container_document_sync_tombstones, public.container_sync_tombstones IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF NOT (SELECT backfill_complete FROM drizzle.discovery_cursor_key WHERE singleton) THEN
    UPDATE public.containers SET discovery_order = public.historical_discovery_order(updated_at, false) WHERE discovery_order = 0;
    UPDATE public.documents SET discovery_order = public.historical_discovery_order(updated_at, false) WHERE discovery_order = 0;
    UPDATE public.container_sync_tombstones SET discovery_order = public.historical_discovery_order(updated_at, true) WHERE discovery_order = 0;
    UPDATE public.container_document_sync_tombstones SET discovery_order = public.historical_discovery_order(updated_at, true) WHERE discovery_order = 0;
    UPDATE drizzle.discovery_cursor_key SET backfill_complete = true WHERE singleton;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_tombstones_container_discovery_idx" ON "container_document_sync_tombstones" USING btree ("container_id","discovery_order","document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_tombstones_user_parent_discovery_idx" ON "container_sync_tombstones" USING btree ("user_id","parent_id","discovery_order","container_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_tombstones_user_root_discovery_idx" ON "container_sync_tombstones" USING btree ("user_id","root_discovery_visible","discovery_order","container_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "containers_parent_discovery_idx" ON "containers" USING btree ("parent_id","discovery_order","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_discovery_idx" ON "documents" USING btree ("discovery_order","id");
