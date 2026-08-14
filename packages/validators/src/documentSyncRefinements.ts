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

export const documentSyncRequestRuntimeRefinements = [
  ...documentSyncRequestEnvelopeRefinements,
  documentSyncRequestRotationRefinement,
] as const;

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

export const documentSyncResponseRuntimeRefinements = [
  documentSyncResponseRotationRefinement,
  documentSyncResponseCommitLsnModeRefinement,
] as const;
