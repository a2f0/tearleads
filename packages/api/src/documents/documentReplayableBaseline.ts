import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import {
  emptyVersionVector,
  listVersionVectorSpans,
  versionVectorsEqual,
} from "@tearleads/loro";

interface ReplayableBaselineMetadata {
  readonly checkpointKind: string;
  readonly documentId: string;
  readonly metadataHash: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly plaintextHash: string;
  readonly sourceVersionVector: string;
  readonly updateId: string;
}

/**
 * Gate redirect and destructive pruning on the authenticated v2 checkpoint
 * contract. Legacy rotate baselines did not bind their kind/source/snapshot
 * attestation into the signed content-record metadata, so they deliberately do
 * not pass this check.
 */
export async function isAuthenticatedReplayableBaseline(
  input: ReplayableBaselineMetadata,
): Promise<boolean> {
  if (input.checkpointKind !== "rotate_baseline") {
    return false;
  }

  try {
    if (
      !versionVectorsEqual(
        input.sourceVersionVector,
        input.partialEndVersionVector,
      ) ||
      !versionVectorsEqual(
        input.partialStartVersionVector,
        emptyVersionVector(),
      )
    ) {
      return false;
    }
    listVersionVectorSpans({
      partialStartVersionVector: input.partialStartVersionVector,
      partialEndVersionVector: input.partialEndVersionVector,
    });
  } catch {
    return false;
  }

  const expectedMetadataHash = await computeDocumentContentRecordMetadataHash({
    checkpointKind: "rotate_baseline",
    checkpointPayloadKind: "full_history_snapshot",
    documentId: input.documentId,
    partialEndVersionVector: input.partialEndVersionVector,
    partialStartVersionVector: input.partialStartVersionVector,
    plaintextHash: input.plaintextHash,
    sourceVersionVector: input.sourceVersionVector,
    updateId: input.updateId,
  });
  return expectedMetadataHash === input.metadataHash;
}
