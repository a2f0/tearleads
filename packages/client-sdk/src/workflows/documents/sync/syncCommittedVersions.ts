import {
  type createDocument,
  encodeVersionVectorCounters,
  getImportBlobMetadata,
  listVersionVectorSpans,
  mergeVersionVectors,
} from "@tearleads/loro";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import {
  asPeerId,
  type CommittedUpdateSpan,
  committedSpansVersion,
} from "../../../data/documents/shared/sync/peerRebase";

type ImportedDocument = Pick<
  Awaited<ReturnType<typeof createDocument>>,
  "frontiersToVV"
>;

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
 * Causal closure of accepted served updates. The server refuses any update
 * whose declared dependencies are uncommitted, and the reader already verified
 * each served update's Loro payload dependencies against its signed header.
 * Therefore every operation in the causal history of an accepted pulled update
 * is proven committed on the server — even an earlier edit of this device whose
 * acknowledgement was lost before a billing purge (#3263, Residual 5).
 */
function servedDependencyVersions(
  servedUpdates: readonly (CommittedUpdateSpan & {
    readonly updateData?: Uint8Array | undefined;
  })[],
  importedDoc?: ImportedDocument | undefined,
): string[] {
  const versions: string[] = [];
  const frontiers: { counter: number; peer: `${number}` }[] = [];
  for (const update of servedUpdates) {
    if (update.updateData && update.updateData.byteLength > 0) {
      versions.push(
        getImportBlobMetadata(update.updateData).dependencyVersionVector,
      );
    }
    if (importedDoc) {
      for (const span of listVersionVectorSpans(update)) {
        if (span.endCounter > 0) {
          frontiers.push({
            counter: span.endCounter - 1,
            peer: asPeerId(span.peerId),
          });
        }
      }
    }
  }
  if (importedDoc && frontiers.length > 0) {
    versions.push(
      encodeVersionVectorCounters(
        Object.fromEntries(importedDoc.frontiersToVV(frontiers).toJSON()),
      ),
    );
  }
  return versions;
}

/**
 * What a sync pass saw the server hold, for the record's committed version:
 * the spans of the outgoing updates the response acknowledged (a heal's
 * baseline among them), the spans of the served updates the pass accepted,
 * and the causal dependencies of those accepted served updates. A served
 * update the pass voided or held is not counted: the device does not hold
 * its operations as its writer signed them.
 */
export function documentSyncCommittedVersions(
  synced: {
    readonly decryptedUpdates: readonly (CommittedUpdateSpan & {
      readonly updateData?: Uint8Array | undefined;
    })[];
    readonly plan: {
      readonly request: {
        readonly outgoingUpdates: readonly (CommittedUpdateSpan & {
          readonly id: string;
        })[];
      };
    };
    readonly response: Pick<
      SyncRemoteDocumentResult["response"],
      "acceptedOutgoingUpdateIds"
    >;
  },
  importedDoc?: ImportedDocument | undefined,
): string[] {
  const acknowledged = new Set(synced.response.acceptedOutgoingUpdateIds);
  const versions = [
    ...committedUpdateVersions([
      ...synced.plan.request.outgoingUpdates.filter((update) =>
        acknowledged.has(update.id),
      ),
      ...synced.decryptedUpdates,
    ]),
    ...servedDependencyVersions(synced.decryptedUpdates, importedDoc),
  ];
  return versions.length === 0 ? [] : [mergeVersionVectors(versions)];
}
