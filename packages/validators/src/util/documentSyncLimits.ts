export const MAX_DOCUMENT_SYNC_REQUEST_BYTES = 16 * 1024 * 1024;

export const MAX_DOCUMENT_SYNC_OUTGOING_UPDATES = 64;
// Individual updates may use the request's remaining budget. The SDK applies
// the exact serialized-byte ceiling after encryption and trims the batch; a
// smaller estimate here would permanently strand an otherwise valid update.
export const MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS = 64;
export const MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH = 100;
// Derive the aggregate ceiling from the structural limits so every valid link
// set remains syncable after later container moves deepen its paths. This is
// still a finite verification bound; the serialized request has a separate
// 16 MiB ceiling.
export const MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS =
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS *
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH;
// Flag-day product maximum for every document content-key bundle. Create/link
// request validation and the client link preflight keep a greenfield database
// from ever producing a document that cannot fit this sync contract.
export const MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS = 64;
