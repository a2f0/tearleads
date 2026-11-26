import { MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS } from "./util/documentSyncLimits";

export const documentSyncRequestRotationRefinement = {
  description:
    "baselineId and baselineSegmentIndex must be absent together or both present; baselineSegmentCount and baselineSegmentsDigest appear only together and only with them, marking a baseline's final segment; only a final segment may carry coversThroughUpdateId",
  id: "request.rotation-baseline-segment-fields",
} as const;

export const documentSyncRequestEnvelopeRefinements = [
  {
    description:
      "inlineRekeyCommitId must be present exactly when containerRekeys is non-empty",
    id: "request.inline-rekey-commit-marker",
  },
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
  {
    description:
      'historyMode "raw" requires localVersionVector to be null so the complete retained history is requested',
    id: "request.raw-history-null-frontier",
  },
  {
    description:
      "processedThroughUpdateId requires a non-null localVersionVector, so a raw-history pull carries none",
    id: "request.processed-cursor-frontier",
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
    "baselineId and baselineSegmentIndex must be absent together or both present; baselineSegmentCount and baselineSegmentsDigest appear only together and only with them, marking a baseline's final segment; only a final segment may carry coversThroughUpdateId",
  id: "response.rotation-baseline-segment-fields",
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

export const documentSyncResponsePullPageCountRefinement = {
  description:
    "pullPage.throughUpdateId is null exactly when pullPage.throughUpdateCount is 0",
  id: "response.pull-page-update-count",
} as const;

export const documentSyncResponseHistoricalBundlesRefinement = {
  description: "contentKeyBundles carries each content-key epoch at most once",
  id: "response.historical-content-key-bundles",
} as const;

export const documentSyncResponseRuntimeRefinements = [
  documentSyncResponseRotationRefinement,
  documentSyncResponseCommitLsnModeRefinement,
  documentSyncResponseCommitLsnSentinelRefinement,
  documentSyncResponsePullPageRefinement,
  documentSyncResponsePullPageCountRefinement,
  documentSyncResponseHistoricalBundlesRefinement,
] as const;
