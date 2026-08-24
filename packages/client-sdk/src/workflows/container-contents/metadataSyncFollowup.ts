import type { SyncedContainerMetadataState } from "./metadataTypes";

export function shouldRequestContainerMetadataFollowup(input: {
  persisted: Pick<
    SyncedContainerMetadataState,
    "pullContinuationSuperseded" | "record" | "syncIdentitySuperseded"
  >;
  settleOutgoingPass: () => boolean;
}): boolean {
  const { persisted } = input;
  if (
    persisted.syncIdentitySuperseded === true ||
    persisted.pullContinuationSuperseded === true ||
    persisted.record.pullContinuation != null ||
    persisted.record.pullContinuationRecoveryRequired === true
  ) {
    return true;
  }
  return input.settleOutgoingPass();
}
