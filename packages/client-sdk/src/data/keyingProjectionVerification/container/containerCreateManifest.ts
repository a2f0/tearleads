import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";

/**
 * Walk a verified head back to its epoch-1 `container.create`. Head
 * verification already verified every predecessor it cites (a head is only
 * accepted once its previous manifest verified), so the lineage is present in
 * `verifiedByHash`; a gap means the served projection was incomplete.
 */
export function verifiedContainerCreateManifest(input: {
  readonly head: VerifiedContainerAccessManifest;
  readonly label: string;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): VerifiedContainerAccessManifest {
  let current = input.head;
  const visited = new Set<string>();
  while (current.state.previousManifestHash !== null) {
    if (visited.has(current.manifestHash)) {
      throw new KeyingVerificationError(
        "invalid_shape",
        `${input.label} manifest lineage is cyclic`,
      );
    }
    visited.add(current.manifestHash);
    const previous = input.verifiedByHash.get(
      current.state.previousManifestHash,
    );
    if (!previous || previous.state.containerId !== current.state.containerId) {
      throw new KeyingVerificationError(
        "missing_dependency",
        `${input.label} lineage does not reach its container.create`,
      );
    }
    current = previous;
  }
  if (
    current.state.epoch !== 1 ||
    current.event.event.eventType !== "container.create"
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      `${input.label} lineage does not start with container.create`,
    );
  }
  return current;
}
