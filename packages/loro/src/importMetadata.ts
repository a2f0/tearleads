import { bytesToBase64 } from "@tearleads/encoding";
import {
  decodeImportBlobMeta,
  LORO_VERSION,
  type PeerID,
  VersionVector,
} from "loro-crdt";

/**
 * The decoder whose verdicts a reader records: an update this decoder cannot
 * read may be readable by a newer one, so a verdict about it holds only for
 * the decoder that made it.
 */
export function loroDecoderIdentity(): string {
  return `loro-crdt@${LORO_VERSION()}`;
}

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

/**
 * The operations a blob depends on outside itself (its start frontiers), as
 * a version vector: each peer's counter one past the latest op depended on.
 * Loro reads these from the same encoded dependencies its import applies.
 */
function dependencyVersionVector(
  frontiers: ReturnType<typeof decodeImportBlobMeta>["startFrontiers"],
): string {
  const counters = new Map<PeerID, number>();
  for (const { counter, peer } of frontiers) {
    counters.set(peer, Math.max(counters.get(peer) ?? 0, counter + 1));
  }
  return bytesToBase64(VersionVector.parseJSON(counters).encode());
}

export function getImportBlobMetadata(update: Uint8Array): {
  mode: ImportBlobMode;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  dependencyVersionVector: string;
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
    dependencyVersionVector: dependencyVersionVector(metadata.startFrontiers),
  };
}
