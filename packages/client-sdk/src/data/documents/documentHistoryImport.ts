import { base64ToBytes } from "@tearleads/encoding";
import {
  getImportBlobMetadata,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";

/**
 * Import durable-history tail rows into a document. importUpdates would
 * silently ignore a snapshot-mode blob, so a row that holds one is imported
 * on its own.
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
