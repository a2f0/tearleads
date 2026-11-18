-- Acquire the complete metadata lock set without waiting behind an active writer.
LOCK TABLE public.documents, public.containers, public.container_document_sync_tombstones, public.container_sync_tombstones IN ACCESS EXCLUSIVE MODE NOWAIT;
--> statement-breakpoint
ALTER TABLE "container_document_sync_tombstones" ADD COLUMN IF NOT EXISTS "discovery_order" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "container_sync_tombstones" ADD COLUMN IF NOT EXISTS "discovery_order" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "containers" ADD COLUMN IF NOT EXISTS "discovery_order" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "discovery_order" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Private publication metadata. A database retains its cursor key across
-- rolling API deployments and server-secret rotations.
CREATE SCHEMA IF NOT EXISTS drizzle;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS drizzle.discovery_cursor_key (
  singleton boolean PRIMARY KEY CHECK (singleton),
  key_material text NOT NULL,
  publication bigint NOT NULL DEFAULT 0,
  backfill_complete boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
INSERT INTO drizzle.discovery_cursor_key (singleton, key_material) VALUES (true, gen_random_uuid()::text || gen_random_uuid()::text) ON CONFLICT (singleton) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.publish_discovery_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE position bigint;
BEGIN
  -- Only publication serializes. The row was already locked by the mutation.
  -- The row lock lasts through commit. A reader sees the same counter
  -- version as the changes it covers, including on a standby.
  UPDATE drizzle.discovery_cursor_key SET publication = publication + 1
    WHERE singleton RETURNING publication INTO STRICT position;
  -- An update to discovery_order alone does not enqueue this trigger.
  EXECUTE format('UPDATE %s SET discovery_order = $1 WHERE id = $2', TG_RELID::regclass)
    USING position, NEW.id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS publish_container_discovery ON public.containers;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER publish_container_discovery
AFTER INSERT OR UPDATE OF updated_at ON public.containers
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.publish_discovery_order();
--> statement-breakpoint
DROP TRIGGER IF EXISTS publish_container_removal_discovery ON public.container_sync_tombstones;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER publish_container_removal_discovery
AFTER INSERT OR UPDATE OF updated_at ON public.container_sync_tombstones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.publish_discovery_order();
--> statement-breakpoint
DROP TRIGGER IF EXISTS publish_document_discovery ON public.documents;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER publish_document_discovery
AFTER INSERT OR UPDATE OF updated_at ON public.documents
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.publish_discovery_order();
--> statement-breakpoint
DROP TRIGGER IF EXISTS publish_document_removal_discovery ON public.container_document_sync_tombstones;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER publish_document_removal_discovery
AFTER INSERT OR UPDATE OF updated_at ON public.container_document_sync_tombstones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.publish_discovery_order();
--> statement-breakpoint
-- All supported four-digit entity timestamps map below zero, with their
-- microseconds and live-before-removal tie preserved. Positive positions
-- belong to commits made after the short trigger cutover.
CREATE OR REPLACE FUNCTION public.historical_discovery_order(stamp timestamp, removed boolean) RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT greatest(-9223372036854775808::numeric, least(-2::numeric,
    extract(epoch FROM stamp) * 2000000 - 1000000000000000000))::bigint + removed::int
$$;
