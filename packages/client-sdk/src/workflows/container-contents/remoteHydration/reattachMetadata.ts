import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { exportAllUpdates, importUpdates } from "@symcrypt/loro";
import { readContainerMetadataValue } from "../../../data/containers/containerMetadataDocument";
import type { DocumentSyncPullContinuation } from "../../../data/documents/shared/pullContinuation";
import type { ContainerMetadataRecord } from "../containerPersistence";
import type { ContainerMetadataDocumentState } from "./types";

/**
 * Resolve a freshly discovered container's metadata content against dormant
 * retained state (docs/sync-edge-cases.md row 4, access_revoked branch). A
 * dormant record makes this a re-attach: its content is imported into the
 * live document and projected, so a queued local rename or icon edit renders
 * immediately instead of a default name until sync succeeds. Without one, the
 * document seeds fresh with the default projection.
 */
export function reattachDormantContainerMetadata(input: {
  defaultName: string;
  doc: ContainerMetadataDocumentState;
  dormantRecord: ContainerMetadataRecord | null;
  remoteMetadataDocumentId: string;
}): {
  icon: string | null;
  initialSnapshot: string;
  lastCommitLsn: string | null;
  name: string;
  pullContinuation: DocumentSyncPullContinuation | null | undefined;
  pullContinuationRecoveryRequired?: true | undefined;
  snapshotEndVersion: string;
} {
  const { defaultName, doc, dormantRecord } = input;
  // Re-attach when the dormant record describes the SAME remote metadata
  // document — or was never bound to one at all (documentId null: a
  // lost-response create retained via its own tombstone). Only a concrete
  // DIFFERENT id proves the document was replaced while access was revoked;
  // that dead stream's content, marker, and LSN cursor must not carry over.
  const matches =
    dormantRecord !== null &&
    (dormantRecord.documentId === input.remoteMetadataDocumentId ||
      dormantRecord.documentId === null);
  if (!matches || !dormantRecord) {
    return {
      icon: null,
      initialSnapshot: bytesToBase64(exportAllUpdates(doc)),
      lastCommitLsn: null,
      name: defaultName,
      pullContinuation: null,
      snapshotEndVersion: "",
    };
  }

  if (dormantRecord.metadataUpdates) {
    importUpdates(doc, [base64ToBytes(dormantRecord.metadataUpdates)]);
  }
  const metadata = readContainerMetadataValue(doc, defaultName);
  return {
    icon: metadata.icon,
    initialSnapshot:
      dormantRecord.metadataUpdates || bytesToBase64(exportAllUpdates(doc)),
    lastCommitLsn: dormantRecord.lastCommitLsn ?? null,
    name: metadata.name,
    pullContinuation: dormantRecord.pullContinuationRecoveryRequired
      ? dormantRecord.pullContinuation
      : (dormantRecord.pullContinuation ?? null),
    ...(dormantRecord.pullContinuationRecoveryRequired
      ? { pullContinuationRecoveryRequired: true as const }
      : {}),
    snapshotEndVersion: dormantRecord.snapshotEndVersion,
  };
}
