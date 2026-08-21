import {
  emptyVersionVector,
  getImportBlobMetadata,
  versionVectorsEqual,
} from "@symcrypt/loro";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";

export function assertDecryptedDocumentUpdateMetadata(
  updateData: Uint8Array,
  update: DocumentSyncResponse["updates"][number],
): void {
  const decodedMetadata = getImportBlobMetadata(updateData);
  if (
    !versionVectorsEqual(
      decodedMetadata.partialStartVersionVector,
      update.partialStartVersionVector,
    ) ||
    !versionVectorsEqual(
      decodedMetadata.partialEndVersionVector,
      update.partialEndVersionVector,
    )
  ) {
    throw new Error("Document decrypted update version-vector mismatch");
  }
  if (
    update.checkpointKind === "rotate_baseline" &&
    (decodedMetadata.mode !== "snapshot" ||
      !versionVectorsEqual(
        decodedMetadata.partialStartVersionVector,
        emptyVersionVector(),
      ))
  ) {
    throw new Error(
      "Document rotation baseline is not a full-history snapshot",
    );
  }
  if (
    update.checkpointKind === undefined &&
    decodedMetadata.mode !== "update" &&
    decodedMetadata.mode !== "outdated-update"
  ) {
    throw new Error("Document ordinary update payload is not an update blob");
  }
}
