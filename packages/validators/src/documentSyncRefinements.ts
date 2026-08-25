import { MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS } from "./util/documentSyncLimits";

export const documentSyncRequestRotationRefinement = {
  description:
    "checkpointKind, checkpointPayloadKind, and sourceVersionVector must be absent together or form a rotation baseline",
  id: "request.rotation-checkpoint-fields",
} as const;

export const documentSyncRequestEnvelopeRefinements = [
  {
    description:
      "authorizingContainerPathRefs is required when outgoingUpdates is non-empty",
    id: "request.authorizing-paths-for-writes",
  },
  {
    description:
      "containerRekeys may be non-empty only when outgoingUpdates is non-empty",
    id: "request.container-rekeys-require-write",
  },
  {
    description: "outgoing update ids must be unique within the request",
    id: "request.unique-outgoing-update-ids",
  },
] as const;

export const documentSyncRequestPullRefinements = [
  {
    description:
      "a request carrying pullCursor must not contain outgoing updates, container rekeys, a content-key bundle, or authorizing paths",
    id: "request.pull-continuation-read-only",
  },
  {
    description:
      'historyMode "raw" must not be combined with outgoing updates, container rekeys, a content-key bundle, or authorizing paths',
    id: "request.raw-history-read-only",
  },
] as const;

export const documentSyncRequestRuntimeRefinements = [
  ...documentSyncRequestEnvelopeRefinements,
  ...documentSyncRequestPullRefinements,
  documentSyncRequestRotationRefinement,
] as const;

export const documentLinkSetPathRefinement = {
  description: `authorizingContainerPathRefs and targetContainerPathRefs may contain at most ${MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS} references in total`,
  id: "request.post-link-authorization-path-total-references",
} as const;

export const documentSyncResponseRotationRefinement = {
  description:
    "checkpointKind, checkpointPayloadKind, and sourceVersionVector must be absent together or form a rotation baseline",
  id: "response.rotation-checkpoint-fields",
} as const;

export const documentSyncResponseCommitLsnModeRefinement = {
  description:
    'commitLsnMode "untracked" requires the commitLsn "0/0" sentinel',
  id: "response.untracked-commit-lsn-sentinel",
} as const;

export const documentSyncResponseCommitLsnSentinelRefinement = {
  description:
    'commitLsn "0/0" requires commitLsnMode "untracked" in the same response',
  id: "response.untracked-commit-lsn-mode",
} as const;

export const documentSyncResponsePullPageRefinement = {
  description:
    "pullPage.hasMore is true exactly when pullPage.nextCursor is non-null",
  id: "response.pull-page-continuation",
} as const;

export const documentSyncResponseRuntimeRefinements = [
  documentSyncResponseRotationRefinement,
  documentSyncResponseCommitLsnModeRefinement,
  documentSyncResponseCommitLsnSentinelRefinement,
  documentSyncResponsePullPageRefinement,
] as const;
