import { readHashArray, throwVerification } from "./shared";
import type { VerifiedContainerAccessManifest, WriteHeader } from "./types";

export function readWriteHeaderCitations(value: unknown): string[] {
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
