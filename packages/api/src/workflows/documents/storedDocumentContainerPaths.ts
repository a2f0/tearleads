import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";

const MAX_CONTAINER_PATH_DEPTH = 100;

/** The loader must verify each exact stored head before returning it. */
export async function loadCitedDocumentContainerPaths(input: {
  readonly dependencyManifestHashes: readonly string[];
  readonly loadManifest: (
    hash: string,
  ) => Promise<VerifiedContainerAccessManifest>;
}): Promise<VerifiedContainerAccessManifest[][]> {
  const cited = new Map<string, VerifiedContainerAccessManifest>();
  for (const hash of input.dependencyManifestHashes) {
    const manifest = await input.loadManifest(hash);
    if (manifest.manifestHash !== hash) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "stored container dependency does not match its citation",
      );
    }
    if (cited.has(manifest.state.containerId)) {
      throw new KeyingVerificationError(
        "duplicate_entry",
        "document event cites two heads of one container",
      );
    }
    cited.set(manifest.state.containerId, manifest);
  }
  return [...cited.values()].map((leaf) => {
    const reversed: VerifiedContainerAccessManifest[] = [];
    const seen = new Set<string>();
    let id: string | null = leaf.state.containerId;
    while (id !== null) {
      if (seen.has(id)) {
        throw new KeyingVerificationError(
          "object_mismatch",
          "cited container path contains a cycle",
        );
      }
      if (reversed.length >= MAX_CONTAINER_PATH_DEPTH) {
        throw new KeyingVerificationError(
          "object_mismatch",
          "container path exceeds maximum depth",
        );
      }
      seen.add(id);
      const manifest = cited.get(id);
      if (!manifest) {
        throw new KeyingVerificationError(
          "missing_dependency",
          `document event does not cite ancestor ${id}`,
        );
      }
      reversed.push(manifest);
      id = manifest.state.parentContainerId;
    }
    return reversed.reverse();
  });
}
