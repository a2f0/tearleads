import {
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
  MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH,
} from "@tearleads/validators/util";
import type { VerifiedContainerAccessManifest } from "../containerAccess/containerAccessTypes";
import { readHashArray, readString, throwVerification } from "../core/shared";
import type { ContentObjectKind, WriteHeader } from "./writeHeaderTypes";

/**
 * The device a header's writer signed on: any non-empty name up to a fixed
 * length. Nothing else in a header is a free string its writer chooses, so
 * with the citation bound this bounds every header.
 */
export function readWriterDeviceId(record: Record<string, unknown>): string {
  const deviceId = readString(record, "writerDeviceId", "write header");
  if (deviceId.length > MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH) {
    throwVerification(
      "invalid_shape",
      `write header.writerDeviceId may be at most ${MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH} characters`,
    );
  }
  return deviceId;
}

/**
 * A document write header cites the container manifests of its authorizing
 * paths, and a document's sync contract bounds those references. No valid
 * document header cites more, so one that does is refused before its hashes
 * are read: a header is stored and served with its update, and this is what
 * keeps its size bounded where nothing checks its authorization yet, as when
 * a baseline segment is staged. A blob header's citations are bounded by its
 * own request.
 */
export function readWriteHeaderCitations(
  value: unknown,
  objectKind: ContentObjectKind,
): string[] {
  if (
    objectKind === "document" &&
    Array.isArray(value) &&
    value.length > MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS
  ) {
    throwVerification(
      "invalid_shape",
      `write header dependencyManifestHashes may cite at most ${MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS} container manifests`,
    );
  }
  const hashes = readHashArray(value, "write header dependencyManifestHashes");
  const canonical = [...new Set(hashes)].sort();
  if (
    hashes.length !== canonical.length ||
    hashes.some((hash, index) => hash !== canonical[index])
  ) {
    throwVerification(
      "invalid_shape",
      "write header dependency hashes must be sorted and unique",
    );
  }
  return hashes;
}

export function assertWriteHeaderPathCitations(
  header: WriteHeader,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
): void {
  const hashes = [
    ...new Set(paths.flatMap((path) => path.map((head) => head.manifestHash))),
  ].sort();
  if (
    hashes.length === 0 ||
    hashes.length !== header.dependencyManifestHashes.length ||
    hashes.some(
      (hash, index) => hash !== header.dependencyManifestHashes[index],
    )
  ) {
    throwVerification(
      "hash_mismatch",
      "write header does not cite its complete authorizing container paths",
    );
  }
}
