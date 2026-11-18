import type { ContainerMetadataSyncAttempt } from "./metadataRemoteSync";
import type { SyncedContainerMetadataState } from "./metadataTypes";

/**
 * Whether a metadata read resumed an earlier pull's pages, so it stopped at
 * that pull's upper bound, which can predate a signal raised since. Decided
 * from the continuation the read consumed, not one observed before it.
 */
export function resumedEarlierMetadataPull(
  attempt: Pick<
    ContainerMetadataSyncAttempt,
    "consumedPullContinuation" | "requestRecord"
  >,
): boolean {
  return (
    attempt.consumedPullContinuation != null ||
    attempt.requestRecord.pullContinuationRecoveryRequired === true
  );
}

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
