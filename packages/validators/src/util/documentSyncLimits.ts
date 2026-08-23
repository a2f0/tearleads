export const MAX_DOCUMENT_SYNC_REQUEST_BYTES = 16 * 1024 * 1024;

// A response page must be able to carry the largest accepted atomic rotation
// baseline (the 100 MiB route ceiling) plus its signed metadata and key-bundle
// envelope. Ordinary sync updates remain constrained by the smaller request
// ceiling above.
export const MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES = 128 * 1024 * 1024;
export const MAX_DOCUMENT_SYNC_RESPONSE_ENVELOPE_BYTES = 16 * 1024 * 1024;
export const MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES =
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES -
  MAX_DOCUMENT_SYNC_RESPONSE_ENVELOPE_BYTES;
export const MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES = 64;
export const MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH = 512;

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
