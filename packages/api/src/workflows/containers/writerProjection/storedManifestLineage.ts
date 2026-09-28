import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";

interface StoredManifestLineageNode {
  readonly manifestHash: string;
  readonly containerId: string;
  readonly organizationId: string;
  readonly depth: number;
  /** Entry n is the ancestor 2**n edges before this node. */
  readonly ancestors: readonly StoredManifestLineageNode[];
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

function appendNode(
  manifest: VerifiedContainerAccessManifest,
  parent: StoredManifestLineageNode | undefined,
): StoredManifestLineageNode {
  const ancestors: StoredManifestLineageNode[] = parent ? [parent] : [];
  for (let level = 0; ; level += 1) {
    const jump = ancestors[level]?.ancestors[level];
    if (!jump) break;
    ancestors.push(jump);
  }
  return {
    manifestHash: manifest.manifestHash,
    containerId: manifest.state.containerId,
    organizationId: manifest.state.organizationId,
    depth: parent ? parent.depth + 1 : 0,
    ancestors,
  };
}

async function indexLineage(input: LineageInput): Promise<void> {
  const { selected, floor, lineageByHash } = input;
  const pending: VerifiedContainerAccessManifest[] = [];
  const seen = new Set<string>();
  let head: VerifiedContainerAccessManifest | undefined = selected;
  let parent: StoredManifestLineageNode | undefined;
  while (head) {
    assertSameContainer(head.state, floor);
    parent = lineageByHash.get(head.manifestHash);
    if (parent) break;
    if (seen.has(head.manifestHash))
      throw new KeyingVerificationError(
        "object_mismatch",
        "ancestor lineage is cyclic",
      );
    seen.add(head.manifestHash);
    pending.push(head);
    const previousHash: string | null = head.state.previousManifestHash;
    parent = previousHash ? lineageByHash.get(previousHash) : undefined;
    if (parent) break;
    head = previousHash ? await input.loadManifest(previousHash) : undefined;
    if (head && head.manifestHash !== previousHash)
      throw new KeyingVerificationError(
        "object_mismatch",
        "ancestor lineage does not match its citation",
      );
  }
  if (parent) assertSameContainer(parent, floor);
  for (const manifest of pending.reverse()) {
    parent = appendNode(manifest, parent);
    lineageByHash.set(manifest.manifestHash, parent);
  }
}

/** Request-local index: shared ancestors are indexed once; queries take O(log N). */
export async function storedManifestDescendsFrom(
  input: LineageInput,
): Promise<boolean> {
  await indexLineage(input);
  const { selected, floor, lineageByHash } = input;
  let candidate = lineageByHash.get(selected.manifestHash);
  const floorNode = lineageByHash.get(floor.manifestHash);
  if (!candidate || !floorNode || candidate.depth < floorNode.depth)
    return false;
  let distance = candidate.depth - floorNode.depth;
  for (let level = 0; distance > 0 && candidate; level += 1) {
    if (distance % 2 === 1) candidate = candidate.ancestors[level];
    distance = Math.floor(distance / 2);
  }
  return candidate?.manifestHash === floor.manifestHash;
}
