-- Every insert into document_updates increments update_count, advances
-- attribution_revision, and stamps updated_at in one statement. Stamping
-- updated_at enqueues the deferred publish_document_discovery trigger on
-- every insert path, so callers cannot forget to republish a document row
-- and each accepted update writes documents twice (this update plus the
-- deferred discovery_order stamp) instead of three times (#3342).
CREATE OR REPLACE FUNCTION public.count_document_updates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.documents AS document
    SET update_count = document.update_count + inserted.updates,
        attribution_revision = document.attribution_revision + 1,
        updated_at = GREATEST(document.updated_at, timezone('UTC', clock_timestamp()))
    FROM (
      SELECT document_id, count(*)::int AS updates
        FROM inserted_document_updates GROUP BY document_id
    ) AS inserted
    WHERE document.id = inserted.document_id;
  RETURN NULL;
END;
$$;
