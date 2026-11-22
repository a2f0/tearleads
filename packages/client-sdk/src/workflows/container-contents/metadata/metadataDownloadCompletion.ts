import { emptyVersionVector } from "@tearleads/loro";
import { deriveMetadataEndVersion } from "../../../data/persistence/container-contents/containerMetadataRows";
import type { ContainerRecord } from "../../../data/persistence/container-contents/containerPersistence";
import type { DomainScope } from "../../../data/shared/domainScope";
import { recordDomainCompletedDownload } from "../../../data/sync/downloadHistory";
import type { ContainerMetadataSyncAttempt } from "./metadataRemoteSync";
import { resumedEarlierMetadataPull } from "./metadataSyncFollowup";
import type { ContainerMetadataState } from "./metadataTypes";

type ContainerMetadataRecord = ContainerMetadataState["record"];

/**
 * Whether a folder's metadata record is in the download queue as
 * `listPendingDownloads` reads it: a synced folder whose metadata was never
 * pulled, or whose stored continuation is not null. A continuation that
 * failed to parse is still a stored one, so recovery counts too. The query
 * also requires the folder's row, which the metadata persist that produced
 * the record wrote with it. `metadataDownloadQueueRule.test.ts` pins this
 * against the query.
 */
export function isQueuedForDownload(record: ContainerMetadataRecord): boolean {
  if (record.documentId === null) return false;
  if (
    (record.pullContinuation ?? null) !== null ||
    record.pullContinuationRecoveryRequired === true
  )
    return true;
  const frontier = deriveMetadataEndVersion(record.metadataUpdates);
  return frontier === "" || frontier === emptyVersionVector();
}

/**
 * Record a finished folder download in the scope's history: a metadata pull
 * that took the folder out of the queue it was in when the request was made.
 * A pull of a folder already stored, such as a rename, is a sync.
 */
export function noteContainerMetadataDownloadDrained(input: {
  readonly container: ContainerRecord;
  readonly domainScope: DomainScope;
  readonly storedRecord: ContainerMetadataRecord;
  readonly syncAttempt: Pick<
    ContainerMetadataSyncAttempt,
    "consumedPullContinuation" | "requestRecord"
  >;
}): void {
  const { container, storedRecord, syncAttempt } = input;
  if (
    !(
      resumedEarlierMetadataPull(syncAttempt) ||
      isQueuedForDownload(syncAttempt.requestRecord)
    )
  )
    return;
  if (storedRecord.documentId === null || isQueuedForDownload(storedRecord))
    return;
  recordDomainCompletedDownload(input.domainScope, {
    documentId: storedRecord.documentId,
    localId: container.id,
    objectKind: "container",
    title: container.name,
  });
}
