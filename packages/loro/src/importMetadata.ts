import { bytesToBase64 } from "@tearleads/encoding";
import { decodeImportBlobMeta } from "loro-crdt";

export type ImportBlobMode = "snapshot" | "shallow-snapshot" | "update";

export function requireCurrentImportBlobMode(
  mode: ReturnType<typeof decodeImportBlobMeta>["mode"],
): ImportBlobMode {
  if (mode === "outdated-snapshot" || mode === "outdated-update") {
    throw new Error(
      "Obsolete Loro encoding; reset the document before continuing",
    );
  }
  return mode;
}

export function getImportBlobMetadata(update: Uint8Array): {
  mode: ImportBlobMode;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
} {
  const metadata = decodeImportBlobMeta(update, true);
  return {
    mode: requireCurrentImportBlobMode(metadata.mode),
    partialStartVersionVector: bytesToBase64(
      metadata.partialStartVersionVector.encode(),
    ),
    partialEndVersionVector: bytesToBase64(
      metadata.partialEndVersionVector.encode(),
    ),
  };
}
