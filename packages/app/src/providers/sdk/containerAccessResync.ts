import type { Tearleads } from "@tearleads/client-sdk";

interface SubtreeNode {
  readonly id: string;
  readonly parentId: string | null;
}

function resolveNodeSubtreeCoverage(
  byId: ReadonlyMap<string, SubtreeNode>,
  startId: string,
  inSubtree: Map<string, boolean>,
): void {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = startId;
  let covered = false;
  while (cursor !== null) {
    const cached = inSubtree.get(cursor);
    if (cached !== undefined) {
      covered = cached;
      break;
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    chain.push(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  for (const id of chain) inSubtree.set(id, covered);
}

/**
 * Expand flagged root container ids over every locally known descendant in
 * O(N) time so a root-scoped `resync_required` revalidates both the root and
 * its known subtree.
 */
function expandKnownSubtreeNodes<T extends SubtreeNode>(
  nodes: ReadonlyArray<T>,
  flagged: ReadonlySet<string>,
): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const inSubtree = new Map<string, boolean>();
  for (const id of flagged) inSubtree.set(id, true);
  for (const node of nodes) {
    if (!inSubtree.has(node.id)) {
      resolveNodeSubtreeCoverage(byId, node.id, inSubtree);
    }
  }
  return nodes.filter((node) => inSubtree.get(node.id) === true);
}

/**
 * Revalidate affected contents, then re-list the root lane plus each flagged
 * container's (and its known subtree's) parent lane and own child lane once.
 */
export async function resyncContainerAccess(
  tearleads: Tearleads,
  containerIds: readonly string[],
): Promise<void> {
  const flagged = new Set(containerIds);
  // Notify open SDK stores before re-listing: eviction removed the root from
  // interest, so a subsequent parent hint cannot identify its stale projection.
  tearleads.events.push({
    id: crypto.randomUUID(),
    type: "resync_required",
    containerIds: [...flagged],
  });
  let tree:
    | ReturnType<Tearleads["deviceFirst"]["open"]>["containerStore"]
    | null = null;
  let expandedNodes: ReadonlyArray<SubtreeNode> = [];
  try {
    tree = tearleads.deviceFirst.open().containerStore;
    expandedNodes = expandKnownSubtreeNodes(tree.getSnapshot().nodes, flagged);
  } catch {
    // Runtime not ready; reconnect will revalidate from a ready tree.
  }
  const revalidateIds = new Set<string>([
    ...flagged,
    ...expandedNodes.map((node) => node.id),
  ]);
  for (const containerId of revalidateIds) {
    try {
      tearleads.deviceFirst
        .open()
        .reconciler.enqueueContainer(containerId, "active", true);
    } catch {
      // Runtime not ready; reconnect will revalidate the ready tree.
    }
  }
  if (!tree) return;
  try {
    // Nested tombstones are returned by their parent lane, and a child created
    // while this client missed its hint (a reconnect resync) is returned only
    // by the flagged container's own lane. Batch both with one root refresh
    // instead of repeating that refresh for every container.
    const parentIds = [
      ...new Set([
        ...expandedNodes.flatMap((node) =>
          node.parentId !== null ? [node.parentId] : [],
        ),
        ...expandedNodes.map((node) => node.id),
      ]),
    ];
    await tree.refreshRootLane(parentIds.length ? { parentIds } : undefined);
  } catch {
    // Runtime not ready; the next reconnect revalidates from a ready tree.
  }
}
