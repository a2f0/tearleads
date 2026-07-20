import { base64ToBytes } from "@tearleads/encoding";
import { getImportBlobMetadata } from "@tearleads/loro";

/**
 * Derive the encoded end version vector of a serialized Loro snapshot.
 *
 * Persisted alongside `documents.loroSnapshot` so diagnostic readers (the
 * pending-write queue's deferred-tail scan) can compare version coverage from
 * a narrow indexed column instead of materializing every snapshot blob and
 * decoding it per row. Returns the empty string for an empty or undecodable
 * snapshot, which readers treat as "no deferred tail claimable".
 */
export function deriveSnapshotEndVersion(loroSnapshot: string): string {
  if (loroSnapshot.length === 0) {
    return "";
  }

  try {
    return getImportBlobMetadata(base64ToBytes(loroSnapshot))
      .partialEndVersionVector;
  } catch {
    return "";
  }
}
