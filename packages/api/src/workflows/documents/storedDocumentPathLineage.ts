import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";

import {
  type StoredManifestLineage,
  storedManifestDescendsFrom,
} from "../containers/writerProjection/storedManifestLineage";

type LoadManifest = (hash: string) => Promise<VerifiedContainerAccessManifest>;

/** A selected ancestor cannot precede or fork from a head the child proves. */
export async function assertStoredDocumentPathLineage(input: {
  readonly path: readonly VerifiedContainerAccessManifest[];
  readonly loadManifest: LoadManifest;
  readonly lineageByHash: StoredManifestLineage;
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
    if (
      !(await storedManifestDescendsFrom({
        selected: head,
        floor,
        loadManifest: input.loadManifest,
        lineageByHash: input.lineageByHash,
      }))
    )
      throw new KeyingVerificationError(
        "rollback",
        "document event cites an ancestor that does not descend from the head an earlier signed statement already proved current",
      );
  }
}
