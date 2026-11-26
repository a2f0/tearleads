import { getImportBlobMetadata, versionVectorsEqual } from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";

export function assertDecryptedDocumentUpdateMetadata(
  updateData: Uint8Array,
  update: Pick<
    DocumentSyncResponse["updates"][number],
    | "dependencyVersionVector"
    | "partialEndVersionVector"
    | "partialStartVersionVector"
  >,
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
  // The API committed every op the update declares it depends on before it
  // accepted it. A payload that depends on other ops, such as one its writer
  // could predict but nobody committed, is void for every reader alike. Loro
  // reads these from the same encoded dependencies its import applies, so
  // the comparison needs no trust in the blob's checksum.
  if (
    !versionVectorsEqual(
      decodedMetadata.dependencyVersionVector,
      update.dependencyVersionVector,
    )
  ) {
    throw new Error("Document decrypted update dependency mismatch");
  }
  // Every served update is an update blob, a rotation baseline's segments
  // included: a baseline is its history cut into updates, never a snapshot.
  if (decodedMetadata.mode !== "update") {
    throw new Error("Document update payload is not an update blob");
  }
}
