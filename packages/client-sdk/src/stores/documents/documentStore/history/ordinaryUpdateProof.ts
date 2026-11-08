import { base64ToBytes } from "@tearleads/encoding";
import {
  getImportBlobMetadata,
  updateMatchesDocumentHistory,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { PendingUpdateRecord } from "../../../../workflows/documents";
import type { DocumentState } from "../state";

/**
 * The bytes of an ordinary (non-checkpoint) queued update when the live
 * document proves them: the blob is an `update`, its decoded start/end equal
 * the row's declared vectors, the document covers the end, and the blob holds
 * exactly the document's operations for that range. Otherwise null.
 */
export function provenOrdinaryUpdateBytes(
  doc: DocumentState,
  update: Pick<
    PendingUpdateRecord,
    | "partialEndVersionVector"
    | "partialStartVersionVector"
    | "sourceVersionVector"
    | "updateData"
  >,
): Uint8Array | null {
  if (update.sourceVersionVector != null) return null;
  try {
    const bytes = base64ToBytes(update.updateData);
    const metadata = getImportBlobMetadata(bytes);
    const proven =
      metadata.mode === "update" &&
      versionVectorsEqual(
        metadata.partialStartVersionVector,
        update.partialStartVersionVector,
      ) &&
      versionVectorsEqual(
        metadata.partialEndVersionVector,
        update.partialEndVersionVector,
      ) &&
      updateMatchesDocumentHistory(doc, bytes);
    return proven ? bytes : null;
  } catch {
    return null;
  }
}
