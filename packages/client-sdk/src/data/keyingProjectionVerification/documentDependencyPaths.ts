import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";

/**
 * Rebuild historical authorization from the event's signed heads, not from
 * creation-time parent pins or the server's grouping of dependency paths.
 * The caller retains checkpoint-enforced authorizing paths when indexing
 * evidence for a leaf; unsigned dependency paths cannot overwrite them.
 */
export function resolveEventContainerPaths(input: {
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly dependencyManifestHashes: readonly string[];
  readonly targetManifestHash: string;
}): {
  dependencyContainerPaths: VerifiedContainerAccessManifest[][];
  targetContainerPath: readonly VerifiedContainerAccessManifest[] | undefined;
} {
  const manifests = new Map<string, VerifiedContainerAccessManifest>();
  for (const path of input.containerPathByManifestHash.values()) {
    for (const manifest of path) {
      manifests.set(manifest.manifestHash, manifest);
    }
  }
  const cited = new Map<string, VerifiedContainerAccessManifest>();
  for (const hash of input.dependencyManifestHashes) {
    const manifest = manifests.get(hash);
    if (!manifest) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Document event cites an unavailable container manifest",
      );
    }
    if (cited.has(manifest.state.containerId)) {
      throw new KeyingVerificationError(
        "duplicate_entry",
        "Document event cites two heads of one container",
      );
    }
    cited.set(manifest.state.containerId, manifest);
  }
  const dependencyContainerPaths = [...cited.values()].map((leaf) => {
    const reversed: VerifiedContainerAccessManifest[] = [];
    const seen = new Set<string>();
    let containerId: string | null = leaf.state.containerId;
    while (containerId !== null) {
      if (seen.has(containerId) || reversed.length >= 100) {
        throw new KeyingVerificationError(
          "object_mismatch",
          "Document event cited container path is cyclic or too deep",
        );
      }
      seen.add(containerId);
      const ancestor = cited.get(containerId);
      if (!ancestor) {
        throw new KeyingVerificationError(
          "missing_dependency",
          `Document event does not cite ancestor ${containerId}`,
        );
      }
      reversed.push(ancestor);
      containerId = ancestor.state.parentContainerId;
    }
    return reversed.reverse();
  });
  return {
    dependencyContainerPaths,
    targetContainerPath: dependencyContainerPaths.find(
      (path) => path.at(-1)?.manifestHash === input.targetManifestHash,
    ),
  };
}
