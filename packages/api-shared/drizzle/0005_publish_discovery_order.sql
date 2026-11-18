-- A lane can span organizations and mix live rows with removals. One order is
-- shared by all four sources. CACHE 1 prevents a session from reserving later
-- values that it could publish after another session used a larger value.
CREATE SEQUENCE public.discovery_publication_order AS bigint CACHE 1;
--> statement-breakpoint
-- Preserve the order of existing entity timestamps including microseconds.
-- On a historical exact timestamp tie an object's removal follows its live
-- state. Different IDs at the same order remain pageable by ID.
WITH live_containers AS (
  UPDATE public.containers
  SET discovery_order = (extract(epoch FROM updated_at) * 1000000)::bigint * 2
  RETURNING discovery_order
), removed_containers AS (
  UPDATE public.container_sync_tombstones
  SET discovery_order = (extract(epoch FROM updated_at) * 1000000)::bigint * 2 + 1
  RETURNING discovery_order
), live_documents AS (
  UPDATE public.documents
  SET discovery_order = (extract(epoch FROM updated_at) * 1000000)::bigint * 2
  RETURNING discovery_order
), removed_documents AS (
  UPDATE public.container_document_sync_tombstones
  SET discovery_order = (extract(epoch FROM updated_at) * 1000000)::bigint * 2 + 1
  RETURNING discovery_order
)
SELECT setval('public.discovery_publication_order', greatest(1,
  (SELECT max(discovery_order) FROM live_containers),
  (SELECT max(discovery_order) FROM removed_containers),
  (SELECT max(discovery_order) FROM live_documents),
  (SELECT max(discovery_order) FROM removed_documents)
));
--> statement-breakpoint
CREATE FUNCTION public.publish_discovery_order() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only publication serializes. The row was already locked by the mutation.
  -- Sequence gaps after rollback are harmless. This UPDATE cannot enqueue this
  -- trigger again because it does not name updated_at.
  PERFORM pg_advisory_xact_lock(7315420191);
  EXECUTE format('UPDATE %s SET discovery_order = nextval(''public.discovery_publication_order'') WHERE id = $1',
                 TG_RELID::regclass) USING NEW.id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER publish_container_discovery
AFTER INSERT OR UPDATE OF updated_at ON public.containers
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.publish_discovery_order();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER publish_container_removal_discovery
AFTER INSERT OR UPDATE OF updated_at ON public.container_sync_tombstones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.publish_discovery_order();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER publish_document_discovery
AFTER INSERT OR UPDATE OF updated_at ON public.documents
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.publish_discovery_order();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER publish_document_removal_discovery
AFTER INSERT OR UPDATE OF updated_at ON public.container_document_sync_tombstones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.publish_discovery_order();
