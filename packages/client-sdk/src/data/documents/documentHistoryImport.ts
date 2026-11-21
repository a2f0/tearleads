import { base64ToBytes } from "@tearleads/encoding";
import {
  getImportBlobMetadata,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";

/**
 * Import durable-history tail rows into a document. Rotation baselines travel
 * through the tail as snapshot-mode blobs, which importUpdates would silently
 * ignore — import them individually.
 */
export function importDocumentHistoryTailUpdates(
  doc: Parameters<typeof importSnapshot>[0],
  tailUpdates: readonly string[],
): void {
  const ordinaryUpdates: Uint8Array[] = [];
  for (const encoded of tailUpdates) {
    const bytes = base64ToBytes(encoded);
    if (getImportBlobMetadata(bytes).mode === "snapshot") {
      importSnapshot(doc, bytes);
    } else {
      ordinaryUpdates.push(bytes);
    }
  }
  if (ordinaryUpdates.length > 0) {
    importUpdates(doc, ordinaryUpdates);
  }
}
