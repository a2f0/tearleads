-- Each document update stores the dependency version vector its writer signed
-- in the content-record metadata (#3194): the ops it depends on outside
-- itself, which the API requires to be committed and every reader checks
-- against the payload. Updates signed before this change declare none, and
-- the server cannot derive one from their ciphertext, so pre-cutover document
-- data is reset under the greenfield ruling: with no default, this fails, and
-- the migrator's transaction rolls back, on a database that still holds
-- update rows.
ALTER TABLE "document_updates" ADD COLUMN "dependency_version_vector" text NOT NULL;