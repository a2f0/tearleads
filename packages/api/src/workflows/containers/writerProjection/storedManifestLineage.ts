import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";

interface StoredManifestLineageNode {
  readonly manifestHash: string;
  readonly containerId: string;
  readonly organizationId: string;
  readonly epoch: number;
  readonly previousManifestHash: string | null;
  /** Entry n is the ancestor 2**n edges before this node, loaded on demand. */
  readonly ancestors: Map<number, StoredManifestLineageNode>;
}

export type StoredManifestLineage = Map<string, StoredManifestLineageNode>;

interface LineageInput {
  readonly selected: VerifiedContainerAccessManifest;
  readonly floor: VerifiedContainerAccessManifest;
  readonly lineageByHash: StoredManifestLineage;
  readonly loadManifest: (
    hash: string,
  ) => Promise<VerifiedContainerAccessManifest>;
}

function assertSameContainer(
  value: { readonly containerId: string; readonly organizationId: string },
  floor: VerifiedContainerAccessManifest,
): void {
  if (
    value.containerId !== floor.state.containerId ||
    value.organizationId !== floor.state.organizationId
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "ancestor lineage changes container identity",
    );
}

function toNode(
  manifest: VerifiedContainerAccessManifest,
): StoredManifestLineageNode {
  return {
    manifestHash: manifest.manifestHash,
    containerId: manifest.state.containerId,
    organizationId: manifest.state.organizationId,
    epoch: manifest.state.epoch,
    previousManifestHash: manifest.state.previousManifestHash,
    ancestors: new Map(),
  };
}

async function predecessor(
  node: StoredManifestLineageNode,
  input: LineageInput,
): Promise<StoredManifestLineageNode | undefined> {
  const hash = node.previousManifestHash;
  if (!hash) return undefined;
  const previous =
    input.lineageByHash.get(hash) ?? toNode(await input.loadManifest(hash));
  if (previous.manifestHash !== hash)
    throw new KeyingVerificationError(
      "object_mismatch",
      "ancestor lineage does not match its citation",
    );
  assertSameContainer(previous, input.floor);
  // Verified transitions increase epoch by exactly one. This also rules out
  // cycles without walking farther back than the requested floor.
  if (previous.epoch !== node.epoch - 1)
    throw new KeyingVerificationError(
      "object_mismatch",
      "ancestor lineage is cyclic or skips an epoch",
    );
  input.lineageByHash.set(hash, previous);
  return previous;
}

/** Recursion is by jump level (logarithmic), never by history length. */
async function ancestorAt(
  node: StoredManifestLineageNode,
  level: number,
  input: LineageInput,
): Promise<StoredManifestLineageNode | undefined> {
  const cached = node.ancestors.get(level);
  if (cached) return cached;
  let ancestor: StoredManifestLineageNode | undefined;
  if (level === 0) {
    ancestor = await predecessor(node, input);
  } else {
    const halfway = await ancestorAt(node, level - 1, input);
    ancestor = halfway
      ? await ancestorAt(halfway, level - 1, input)
      : undefined;
  }
  if (ancestor) node.ancestors.set(level, ancestor);
  return ancestor;
}

/** Shared lineage index, extended only as far back as a query's floor. */
export async function storedManifestDescendsFrom(
  input: LineageInput,
): Promise<boolean> {
  const { selected, floor, lineageByHash } = input;
  assertSameContainer(selected.state, floor);
  if (selected.state.epoch < floor.state.epoch) return false;
  let candidate: StoredManifestLineageNode | undefined =
    lineageByHash.get(selected.manifestHash) ?? toNode(selected);
  lineageByHash.set(selected.manifestHash, candidate);
  let distance = selected.state.epoch - floor.state.epoch;
  for (let level = 0; distance > 0 && candidate; level += 1) {
    if (distance % 2 === 1)
      candidate = await ancestorAt(candidate, level, input);
    distance = Math.floor(distance / 2);
  }
  return candidate?.manifestHash === floor.manifestHash;
}
