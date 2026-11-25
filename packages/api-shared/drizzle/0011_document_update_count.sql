-- A document row counts its own updates, so a container listing reports the
-- count (#3256) without scanning the document's history on every page. The
-- column is additive with a default, and the trigger keeps it on every insert
-- path, so the previous Worker keeps working against this schema.
ALTER TABLE "documents" ADD COLUMN "update_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- One statement can insert several updates, for one document or several. An
-- update is inserted after its document row, in the same transaction or a
-- later one, and its writer already holds that document's head lock.
CREATE OR REPLACE FUNCTION public.count_document_updates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.documents AS document
    SET update_count = document.update_count + inserted.updates
    FROM (
      SELECT document_id, count(*)::int AS updates
        FROM inserted_document_updates GROUP BY document_id
    ) AS inserted
    WHERE document.id = inserted.document_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS count_document_updates ON public.document_updates;
--> statement-breakpoint
CREATE TRIGGER count_document_updates
AFTER INSERT ON public.document_updates
REFERENCING NEW TABLE AS inserted_document_updates
FOR EACH STATEMENT EXECUTE FUNCTION public.count_document_updates();
--> statement-breakpoint
-- Rows committed before the trigger existed. Updates are deleted only with
-- their document, so the count never has to go down.
UPDATE public.documents AS document
  SET update_count = counted.updates
  FROM (
    SELECT document_id, count(*)::int AS updates
      FROM public.document_updates GROUP BY document_id
  ) AS counted
  WHERE document.id = counted.document_id;
