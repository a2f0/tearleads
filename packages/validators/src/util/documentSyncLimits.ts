import { MAX_CONTAINER_PATH_LENGTH } from "./containerLimits";

export const MAX_DOCUMENT_SYNC_REQUEST_BYTES = 16 * 1024 * 1024;

// A response page must be able to carry the largest accepted atomic rotation
// baseline (the 32 MiB route ceiling) plus its signed metadata and key-bundle
// envelope, and no more: the API materializes a page and then serializes it,
// so the page and its JSON copy must both fit the 128 MB Workers isolate.
// Ordinary sync updates remain constrained by the smaller request ceiling
// above.
export const MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES = 48 * 1024 * 1024;
export const MAX_DOCUMENT_SYNC_RESPONSE_ENVELOPE_BYTES = 16 * 1024 * 1024;
export const MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES =
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES -
  MAX_DOCUMENT_SYNC_RESPONSE_ENVELOPE_BYTES;
export const MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES = 64;
export const MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH = 512;

export const MAX_DOCUMENT_SYNC_OUTGOING_UPDATES = 64;
// A rotation baseline is an ordered group of updates, its segments, sent
// whole in the one request that rotates: with the unlink, or among a sync's
// outgoing updates. So a group holds at most as many segments as a sync
// carries updates (`MAX_DOCUMENT_SYNC_OUTGOING_UPDATES`, which a test holds
// it to), and one request's bytes bound it sooner.
export const MAX_DOCUMENT_BASELINE_SEGMENTS = 64;
// A baseline too large for one request is staged first: its writer uploads
// every segment but the final one ahead of time, one request each, and the
// rotating request carries the final segment and names the stage. A staged
// baseline holds at most this many segments, the final one included, so a
// group's metadata rows, which commit under the document head lock, stay
// bounded whatever the history's size.
export const MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS = 4_096;
// One staged segment is one ordinary update: its request is held to the sync
// request ceiling (`MAX_DOCUMENT_SYNC_REQUEST_BYTES`, which a test holds it
// to), so every committed segment fits a response page exactly as an update
// a sync committed does.
export const MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES = 16 * 1024 * 1024;
// A stage expires this long after its last staged segment or re-signed
// header, and never later than the maximum after it was opened: a writer that
// stops uploading leaves nothing behind for longer, and one that keeps
// uploading cannot hold staged bytes open indefinitely.
export const DOCUMENT_BASELINE_STAGE_IDLE_SECONDS = 60 * 60;
export const DOCUMENT_BASELINE_STAGE_MAX_SECONDS = 24 * 60 * 60;
// Individual updates may use the request's remaining budget. The SDK applies
// the exact serialized-byte ceiling after encryption and trims the batch; a
// smaller estimate here would permanently strand an otherwise valid update.
export const MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS = 64;
// Derive the aggregate ceiling from the structural limits so every valid link
// set remains syncable after later container moves deepen its paths. This is
// still a finite verification bound; the serialized request has a separate
// 16 MiB ceiling.
export const MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS =
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS * MAX_CONTAINER_PATH_LENGTH;
// Flag-day product maximum for every document content-key bundle. Create/link
// request validation and the client link preflight keep a greenfield database
// from ever producing a document that cannot fit this sync contract.
export const MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS = 64;
