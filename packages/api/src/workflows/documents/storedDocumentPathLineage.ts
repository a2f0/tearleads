import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";

const MAX_MANIFEST_HISTORY_DEPTH = 4_096;

type LoadManifest = (hash: string) => Promise<VerifiedContainerAccessManifest>;

async function descendsFrom(
  selected: VerifiedContainerAccessManifest,
  floor: VerifiedContainerAccessManifest,
  loadManifest: LoadManifest,
): Promise<boolean> {
  let head: VerifiedContainerAccessManifest | undefined = selected;
  const seen = new Set<string>();
  while (head && head.state.epoch >= floor.state.epoch) {
    if (head.manifestHash === floor.manifestHash) return true;
    if (seen.has(head.manifestHash) || seen.size >= MAX_MANIFEST_HISTORY_DEPTH)
      throw new KeyingVerificationError(
        "object_mismatch",
        "ancestor lineage is cyclic or too deep",
      );
    seen.add(head.manifestHash);
    const previousHash: string | null = head.state.previousManifestHash;
    head = previousHash ? await loadManifest(previousHash) : undefined;
    if (
      head &&
      (head.state.containerId !== floor.state.containerId ||
        head.state.organizationId !== floor.state.organizationId)
    )
      throw new KeyingVerificationError(
        "object_mismatch",
        "ancestor lineage changes container identity",
      );
  }
  return false;
}

/** A selected ancestor cannot precede or fork from a head the child proves. */
export async function assertStoredDocumentPathLineage(input: {
  readonly path: readonly VerifiedContainerAccessManifest[];
  readonly loadManifest: LoadManifest;
}): Promise<void> {
  const child = input.path.at(-1);
  if (!child || input.path.length < 2) return;
  const ancestors = new Map(
    input.path.slice(0, -1).map((head) => [head.state.containerId, head]),
  );
  const floors = new Set(child.event.event.dependencyManifestHashes);
  if (child.state.parentManifestHash)
    floors.add(child.state.parentManifestHash);
  for (const hash of floors) {
    const floor = await input.loadManifest(hash);
    const head = ancestors.get(floor.state.containerId);
    if (!head) continue;
    if (!(await descendsFrom(head, floor, input.loadManifest)))
      throw new KeyingVerificationError(
        "rollback",
        "document event cites an ancestor that does not descend from the head an earlier signed statement already proved current",
      );
  }
}
