-- Each document content-key epoch stores the content-key commitment its
-- opening bundle declared (#3194). Envelopes signed before this change carry
-- none, so pre-cutover document data is reset under the greenfield ruling:
-- with no default, this fails, and the migrator's transaction rolls back, on
-- a database that still holds epoch rows.
ALTER TABLE "document_content_key_epochs" ADD COLUMN "content_key_commitment" text NOT NULL;
