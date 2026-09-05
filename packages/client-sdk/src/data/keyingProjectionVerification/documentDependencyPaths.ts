import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { assertCitedAncestorsDoNotRegress } from "./containerAncestorCitations";

const MAX_CONTAINER_PATH_DEPTH = 100;

/**
 * Rebuild historical authorization from the event's signed heads, not from
 * creation-time parent pins or the server's grouping of dependency paths.
 * Paths in the evidence index only supply verified manifests. Authorization
 * uses exactly the ancestor heads this event signed, regardless of grouping.
 * Prefix paths are evidence too; crypto authorization admits only leaves named
 * by the signed document link set or committed content target set.
 */
export function resolveEventContainerPaths(input: {
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly dependencyManifestHashes: readonly string[];
  readonly targetManifestHash?: string;
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
      if (
        seen.has(containerId) ||
        reversed.length >= MAX_CONTAINER_PATH_DEPTH
      ) {
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
      if (ancestor.state.organizationId !== leaf.state.organizationId) {
        throw new KeyingVerificationError(
          "object_mismatch",
          "Document event cited container path crosses organizations",
        );
      }
      reversed.push(ancestor);
      containerId = ancestor.state.parentContainerId;
    }
    const path = reversed.reverse();
    // The cited descendant is itself an earlier signed statement. Its own
    // citations establish floors for every ancestor, even when the server
    // supplied these verified manifests in separate projection paths.
    assertCitedAncestorsDoNotRegress({
      bundlesByHash: new Map(),
      label: "Document event",
      verifiedByHash: manifests,
      citedAncestors: path.slice(0, -1),
      previousManifest: leaf,
    });
    return path;
  });
  return {
    dependencyContainerPaths,
    targetContainerPath:
      input.targetManifestHash === undefined
        ? undefined
        : dependencyContainerPaths.find(
            (path) => path.at(-1)?.manifestHash === input.targetManifestHash,
          ),
  };
}
