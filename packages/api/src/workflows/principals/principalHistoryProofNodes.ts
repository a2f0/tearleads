import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  largestPowerOfTwoLessThan,
  type PrincipalHistoryIndexNode,
} from "@tearleads/crypto";
import { readBufferedPrincipalHistoryNodes } from "./principalHistoryCache";

/** Prefetch untrusted nodes by level; proof construction still checks each hash. */
export async function readPrincipalHistoryProofNodes(
  executor: DatabaseSession,
  rootHash: string,
  treeSize: number,
  versions: readonly number[],
): Promise<Map<string, PrincipalHistoryIndexNode>> {
  const nodes = new Map<string, PrincipalHistoryIndexNode>();
  let level = versions.map((version) => ({
    hash: rootHash,
    size: treeSize,
    position: version - 1,
  }));
  while (level.length > 0) {
    const branches = level.filter(({ size }) => size > 1);
    const stored = await readBufferedPrincipalHistoryNodes(
      executor,
      branches.map(({ hash }) => hash).filter((hash) => !nodes.has(hash)),
    );
    for (const [hash, node] of stored) nodes.set(hash, node);
    level = branches.flatMap(({ hash, size, position }) => {
      const node = nodes.get(hash);
      if (!node) return [];
      const split = largestPowerOfTwoLessThan(size);
      return position < split
        ? [{ hash: node.leftHash, size: split, position }]
        : [
            {
              hash: node.rightHash,
              size: size - split,
              position: position - split,
            },
          ];
    });
  }
  return nodes;
}
