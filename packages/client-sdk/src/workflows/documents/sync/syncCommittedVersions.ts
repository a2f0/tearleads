import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import {
  type CommittedUpdateSpan,
  committedSpansVersion,
} from "../../../data/documents/shared/sync/peerRebase";

/**
 * The `committedVersions` a settlement passes for updates the server holds:
 * one version covering their spans, or none when they carry no operation.
 */
export function committedUpdateVersions(
  updates: readonly CommittedUpdateSpan[],
): string[] {
  const version = committedSpansVersion(updates);
  return version === null ? [] : [version];
}

/**
 * What a sync pass saw the server hold, for the record's committed version:
 * the spans of the outgoing updates the response acknowledged, a heal's
 * baseline among them, and of the served updates the pass accepted. A served
 * update the pass voided or held is not counted: the device does not hold
 * its operations as its writer signed them.
 */
export function documentSyncCommittedVersions(
  synced: Pick<SyncRemoteDocumentResult, "decryptedUpdates" | "plan"> & {
    readonly response: Pick<
      SyncRemoteDocumentResult["response"],
      "acceptedOutgoingUpdateIds"
    >;
  },
): string[] {
  const acknowledged = new Set(synced.response.acceptedOutgoingUpdateIds);
  return committedUpdateVersions([
    ...synced.plan.request.outgoingUpdates.filter((update) =>
      acknowledged.has(update.id),
    ),
    ...synced.decryptedUpdates,
  ]);
}
