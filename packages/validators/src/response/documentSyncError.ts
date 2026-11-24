import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  arraySchema,
  loosePlainObject,
  safeNonNegativeIntegerSchema,
} from "../schema";
import { PRINCIPAL_POLICY_REPAIR_HEAD_LIMIT } from "../util/principalHistoryWire";
import { ReferencedPrincipalStateResponseSchema } from "./principalReference";

export const DOCUMENT_SYNC_ERROR_CODES = {
  checkpointCoverageConflict: "document_sync_checkpoint_coverage_conflict",
  conflict: "document_sync_conflict",
  // An inline container rekey would strand a level above a directly granted
  // container. The write rolled back; the client repairs those containers
  // standalone, where each rekey carries its own descendants, then retries.
  descendantRekeysRequired: "document_sync_descendant_rekeys_required",
  // The request depends on an operation the server has not committed. The
  // write rolled back; the client rebases its unsent ops past those peers'
  // frontiers onto a fresh peer and retries.
  dependencyUncommitted: "document_sync_dependency_uncommitted",
  // The request extends a peer another user owns. The write rolled back; the
  // client rebases its unsent ops on that peer onto a fresh peer and retries.
  peerOwned: "document_sync_peer_owned",
  stateStale: "document_sync_state_stale",
  updateIdConflict: "document_sync_update_id_conflict",
} as const;

export const DocumentSyncErrorCodeSchema = z.literal([
  DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
  DOCUMENT_SYNC_ERROR_CODES.conflict,
  DOCUMENT_SYNC_ERROR_CODES.dependencyUncommitted,
  DOCUMENT_SYNC_ERROR_CODES.descendantRekeysRequired,
  DOCUMENT_SYNC_ERROR_CODES.peerOwned,
  DOCUMENT_SYNC_ERROR_CODES.stateStale,
  DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
]);

/**
 * Most refused peers one `document_sync_peer_owned` or
 * `document_sync_dependency_uncommitted` body names. A request's spans and
 * dependencies are bounded only by its byte ceiling, so the server names the
 * first this many in canonical order and a retry names the rest.
 */
export const MAX_DOCUMENT_PEER_FRONTIERS = 64;

// A Loro peer id is an unsigned 64-bit integer, at most 20 decimal digits.
const MAX_LORO_PEER_ID_DIGITS = 20;

const loroPeerIdSchema = registerJsonSchemaFragment(
  z.custom<string>(
    (value) =>
      typeof value === "string" &&
      value.length <= MAX_LORO_PEER_ID_DIGITS &&
      /^[0-9]+$/u.test(value),
  ),
  {
    maxLength: MAX_LORO_PEER_ID_DIGITS,
    minLength: 1,
    pattern: "^[0-9]+$",
    type: "string",
  },
);

/** A refused peer and the server's committed frontier on it. */
export const DocumentPeerFrontierSchema = loosePlainObject({
  peerId: loroPeerIdSchema,
  committedEndCounter: safeNonNegativeIntegerSchema,
});

export type DocumentPeerFrontier = z.infer<typeof DocumentPeerFrontierSchema>;

export type DocumentSyncErrorCode = z.infer<typeof DocumentSyncErrorCodeSchema>;

/**
 * The refusals whose body names peers with their committed frontiers, for the
 * client to rebase its unsent ops past them onto a fresh peer: one extends a
 * peer another user owns, the other depends on an op nobody committed.
 */
export type DocumentPeerRebaseErrorCode =
  | typeof DOCUMENT_SYNC_ERROR_CODES.dependencyUncommitted
  | typeof DOCUMENT_SYNC_ERROR_CODES.peerOwned;

export function isDocumentPeerRebaseErrorCode(
  value: unknown,
): value is DocumentPeerRebaseErrorCode {
  return (
    value === DOCUMENT_SYNC_ERROR_CODES.dependencyUncommitted ||
    value === DOCUMENT_SYNC_ERROR_CODES.peerOwned
  );
}

export function isDocumentSyncErrorCode(
  value: unknown,
): value is DocumentSyncErrorCode {
  return DocumentSyncErrorCodeSchema.safeParse(value).success;
}

export const DocumentSyncStateStaleErrorResponseSchema = z.looseObject({
  code: z.literal(DOCUMENT_SYNC_ERROR_CODES.stateStale),
  error: z.string().min(1),
  principalHeads: arraySchema(
    ReferencedPrincipalStateResponseSchema,
    PRINCIPAL_POLICY_REPAIR_HEAD_LIMIT,
  ).optional(),
});

export const DocumentSyncErrorResponseSchema = z.looseObject({
  code: DocumentSyncErrorCodeSchema,
  error: z.string().min(1),
  peerFrontiers: arraySchema(
    DocumentPeerFrontierSchema,
    MAX_DOCUMENT_PEER_FRONTIERS,
  ).optional(),
  principalHeads: arraySchema(
    ReferencedPrincipalStateResponseSchema,
    PRINCIPAL_POLICY_REPAIR_HEAD_LIMIT,
  ).optional(),
});

export type DocumentSyncErrorResponse = z.infer<
  typeof DocumentSyncErrorResponseSchema
>;

export function isDocumentSyncErrorResponse(
  value: unknown,
): value is DocumentSyncErrorResponse {
  return DocumentSyncErrorResponseSchema.safeParse(value).success;
}

export function isDocumentSyncStateStaleErrorResponse(
  value: unknown,
): value is DocumentSyncStateStaleErrorResponse {
  return DocumentSyncStateStaleErrorResponseSchema.safeParse(value).success;
}

export type DocumentSyncStateStaleErrorResponse = z.infer<
  typeof DocumentSyncStateStaleErrorResponseSchema
>;

/**
 * Positive server-verified "this document does not exist" signal. Clients run a
 * destructive local teardown when the upstream document is deleted, so that
 * action must never key off a bare HTTP 404 — proxy/tunnel error pages,
 * deploy-skew route misses, and container-level lookups all produce 404s that
 * say nothing about the document. Only the routes' genuine document-existence
 * checks emit this code.
 */
export const DOCUMENT_NOT_FOUND_ERROR_CODE = "document_not_found";

export type DocumentNotFoundErrorCode = typeof DOCUMENT_NOT_FOUND_ERROR_CODE;

export const DocumentNotFoundErrorResponseSchema = z.looseObject({
  code: z.literal(DOCUMENT_NOT_FOUND_ERROR_CODE),
  error: z.string().min(1),
});

export type DocumentNotFoundErrorResponse = z.infer<
  typeof DocumentNotFoundErrorResponseSchema
>;

/**
 * Stable codes for document writer-projection failures that surface as 409s.
 * The route deliberately remaps container-level and dependency 404s to 409
 * (a document-route 404 triggers a destructive client wipe), which used to
 * collapse every origin into an uncoded conflict. These codes let a client
 * report WHICH dependency refused without parsing message text.
 */
export const DOCUMENT_PROJECTION_ERROR_CODES = {
  containerConflict: "document_projection_container_conflict",
  containerUnavailable: "document_projection_container_unavailable",
  contentKeyBundleMissing: "document_projection_content_key_bundle_missing",
  headMissing: "document_projection_head_missing",
  kekTargetsUnavailable: "document_projection_kek_targets_unavailable",
  stateInvalid: "document_projection_state_invalid",
} as const;

export const DocumentProjectionErrorCodeSchema = z.literal([
  DOCUMENT_PROJECTION_ERROR_CODES.containerConflict,
  DOCUMENT_PROJECTION_ERROR_CODES.containerUnavailable,
  DOCUMENT_PROJECTION_ERROR_CODES.contentKeyBundleMissing,
  DOCUMENT_PROJECTION_ERROR_CODES.headMissing,
  DOCUMENT_PROJECTION_ERROR_CODES.kekTargetsUnavailable,
  DOCUMENT_PROJECTION_ERROR_CODES.stateInvalid,
]);

export type DocumentProjectionErrorCode = z.infer<
  typeof DocumentProjectionErrorCodeSchema
>;

// Preserve the writer-projection route's existing sync-code surface. Rotation
// checkpoint coverage is a document-sync submission concern and must not leak
// into this read endpoint merely because both responses share this module.
const DocumentWriterProjectionSyncErrorCodeSchema = z.literal([
  DOCUMENT_SYNC_ERROR_CODES.conflict,
  DOCUMENT_SYNC_ERROR_CODES.stateStale,
  DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
]);

export const DocumentWriterProjectionErrorResponseSchema = z.looseObject({
  code: z.union([
    DocumentProjectionErrorCodeSchema,
    DocumentWriterProjectionSyncErrorCodeSchema,
  ]),
  error: z.string().min(1),
});

export type DocumentWriterProjectionErrorResponse = z.infer<
  typeof DocumentWriterProjectionErrorResponseSchema
>;
