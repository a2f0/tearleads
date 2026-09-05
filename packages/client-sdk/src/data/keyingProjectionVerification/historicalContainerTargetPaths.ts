import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";

const MAX_CONTAINER_PATH_DEPTH = 100;

/**
 * Content-write headers commit leaf targets, unlike document/attachment
 * events which commit full paths. Retain verified pinned ancestry for those
 * historical targets; never use this grouping to fill an event's citations.
 */
export function addHistoricalContainerTargetPaths(input: {
  readonly containerPathByManifestHash: Map<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly manifests: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): void {
  for (const [hash, leaf] of input.manifests) {
    if (input.containerPathByManifestHash.has(hash)) continue;
    const reversed: VerifiedContainerAccessManifest[] = [];
    const seen = new Set<string>();
    let head: VerifiedContainerAccessManifest | undefined = leaf;
    while (head) {
      if (
        seen.has(head.manifestHash) ||
        reversed.length >= MAX_CONTAINER_PATH_DEPTH
      ) {
        throw new KeyingVerificationError(
          "object_mismatch",
          "Verified container target ancestry is cyclic or too deep",
        );
      }
      seen.add(head.manifestHash);
      reversed.push(head);
      if (head.state.parentManifestHash === null) break;
      const parent = input.manifests.get(head.state.parentManifestHash);
      if (
        !parent ||
        parent.state.containerId !== head.state.parentContainerId ||
        parent.state.organizationId !== leaf.state.organizationId
      ) {
        head = undefined;
        break;
      }
      head = parent;
    }
    // An incomplete path remains evidence for citation-driven events, but
    // cannot acquire inherited authority for a content-write target.
    input.containerPathByManifestHash.set(
      hash,
      head ? reversed.reverse() : [leaf],
    );
  }
}
