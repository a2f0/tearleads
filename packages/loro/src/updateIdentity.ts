import type { LoroDoc } from "loro-crdt";
import {
  decodeVersionVector,
  encodeVersionVector,
  exportFullHistoryIdentity,
  getImportBlobMetadata,
  importSnapshot,
  importUpdates,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "./document";

/**
 * Prove that an update or snapshot blob contains the document's exact
 * operations for its declared version-vector range. Rebuild from the exact
 * prefix and compare canonical operation identity so equivalent legacy/current
 * encodings pass without letting same-peer/counter conflicts hide in an import.
 */
export function updateMatchesDocumentHistory(
  doc: LoroDoc,
  update: Uint8Array,
): boolean {
  const metadata = getImportBlobMetadata(update);
  if (
    !satisfiesVersionVector(
      encodeVersionVector(doc),
      metadata.partialEndVersionVector,
    )
  ) {
    return false;
  }

  if (
    versionVectorsEqual(
      metadata.partialStartVersionVector,
      metadata.partialEndVersionVector,
    )
  ) {
    return false;
  }

  let candidate: LoroDoc | null = null;
  try {
    candidate = doc.forkAt(
      doc.vvToFrontiers(
        decodeVersionVector(metadata.partialStartVersionVector),
      ),
    );
    if (
      metadata.mode === "snapshot" ||
      metadata.mode === "outdated-snapshot" ||
      metadata.mode === "shallow-snapshot"
    ) {
      importSnapshot(candidate, update);
    } else {
      importUpdates(candidate, [update]);
    }
    return (
      versionVectorsEqual(
        encodeVersionVector(candidate),
        metadata.partialEndVersionVector,
      ) &&
      exportFullHistoryIdentity(candidate) ===
        exportFullHistoryIdentity(doc, metadata.partialEndVersionVector)
    );
  } catch {
    return false;
  } finally {
    candidate?.free();
  }
}
