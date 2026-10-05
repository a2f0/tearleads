import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalHistoryIndexNodes } from "@tearleads/api-shared/schema";
import {
  compareCanonicalStrings,
  type PrincipalHistoryIndexNode,
} from "@tearleads/crypto";
import { eq, sql } from "drizzle-orm";

export async function selectPrincipalHistoryIndexNode(
  executor: DatabaseSession,
  hash: string,
): Promise<PrincipalHistoryIndexNode | null> {
  const [row] = await executor
    .select()
    .from(principalHistoryIndexNodes)
    .where(eq(principalHistoryIndexNodes.hash, hash))
    .limit(1);
  return row ?? null;
}

export async function upsertPrincipalHistoryIndexNodes(
  executor: DatabaseSession,
  nodes: readonly PrincipalHistoryIndexNode[],
): Promise<void> {
  // Stable lock order for concurrent batches. Each statement has at most
  // 300 parameters, within both supported dialects' limits.
  const sorted = [...nodes].sort((left, right) =>
    compareCanonicalStrings(left.hash, right.hash),
  );
  for (let start = 0; start < sorted.length; start += 100) {
    const batch = sorted.slice(start, start + 100);
    await executor
      .insert(principalHistoryIndexNodes)
      .values(batch)
      .onConflictDoUpdate({
        target: principalHistoryIndexNodes.hash,
        // Replace corrupted cache contents when a verified append rebuilds them.
        set: {
          leftHash: sql`excluded.left_hash`,
          rightHash: sql`excluded.right_hash`,
        },
      });
  }
}
