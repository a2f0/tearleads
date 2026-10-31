import type { PrincipalHistoryIndexNode } from "@tearleads/crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { principalHistoryNodes } from "../../sqlite/schema/principalHistoryEvidenceSchema";
import {
  sqliteInsertBatchSize,
  sqliteRowsPerStatement,
} from "../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../../sqlite/sqliteUpsert";
import type {
  PrincipalHistoryNodeScope,
  PrincipalHistoryRootEdges,
} from "./principalHistoryRootOwnership";

type PrincipalHistoryNodeRow = typeof principalHistoryNodes.$inferSelect;

const NODE_WRITE_BATCH_SIZE = sqliteInsertBatchSize(principalHistoryNodes);
// The scope id binds once per lookup.
const HASH_LOOKUP_BATCH_SIZE = sqliteRowsPerStatement(1, 1);
// The scope and organization ids bind once per statement.
const SCOPED_HASH_BATCH_SIZE = sqliteRowsPerStatement(1, 3);

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

async function loadNodeReferences(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
  hashes: readonly string[],
  into: Map<string, PrincipalHistoryNodeRow | null>,
): Promise<void> {
  const missing = [...new Set(hashes)].filter((hash) => !into.has(hash));
  for (const batch of batches(missing, HASH_LOOKUP_BATCH_SIZE)) {
    for (const hash of batch) into.set(hash, null);
    const rows = await tx
      .select()
      .from(principalHistoryNodes)
      .where(
        and(
          eq(principalHistoryNodes.scopeId, scope.scopeId),
          inArray(principalHistoryNodes.hash, batch),
        ),
      );
    for (const row of rows) into.set(row.hash, row);
  }
}

/**
 * Replays the per-node edge bookkeeping in memory: increment inserts or adds
 * one, decrement floors at zero within the scope's organization, and an edge
 * change keeps the count while marking nodes first stored here as managed. A
 * row is a stored node once it carries child hashes; before that it is only a
 * placeholder for a referenced hash. Folded root edges replay last, in the
 * order root ownership applies them.
 */
function replayNodeEdges(
  scope: PrincipalHistoryNodeScope,
  nodes: readonly PrincipalHistoryIndexNode[],
  loaded: ReadonlyMap<string, PrincipalHistoryNodeRow | null>,
  rootEdges: PrincipalHistoryRootEdges | undefined,
): Map<string, PrincipalHistoryNodeRow | null> {
  const references = new Map(loaded);
  const read = (hash: string) => {
    const reference = references.get(hash);
    if (reference === undefined)
      throw new Error("Principal history node reference was not loaded");
    return reference;
  };
  const increment = (hash: string) => {
    const reference = read(hash);
    references.set(
      hash,
      reference
        ? { ...reference, referenceCount: reference.referenceCount + 1 }
        : {
            ...scope,
            hash,
            referenceCount: 1,
            managed: false,
            leftHash: null,
            rightHash: null,
          },
    );
  };
  const decrement = (hash: string) => {
    const reference = read(hash);
    if (reference?.organizationId === scope.organizationId)
      references.set(hash, {
        ...reference,
        referenceCount: Math.max(reference.referenceCount - 1, 0),
      });
  };
  for (const node of nodes) {
    const previous = read(node.hash);
    if (
      previous?.leftHash !== node.leftHash ||
      previous.rightHash !== node.rightHash
    ) {
      const managed = !previous || previous.managed || !isStoredNode(previous);
      increment(node.leftHash);
      increment(node.rightHash);
      const current = read(node.hash);
      references.set(node.hash, {
        ...(current ?? {
          ...scope,
          hash: node.hash,
          referenceCount: previous?.referenceCount ?? 0,
        }),
        leftHash: node.leftHash,
        rightHash: node.rightHash,
        managed,
      });
      for (const hash of [previous?.leftHash, previous?.rightHash])
        if (hash) decrement(hash);
    }
  }
  // Root ownership's edges follow the page's nodes, as its statements did.
  if (rootEdges) {
    increment(rootEdges.increment);
    if (rootEdges.decrement) decrement(rootEdges.decrement);
  }
  return references;
}

function isStoredNode(row: PrincipalHistoryNodeRow): boolean {
  return row.leftHash !== null && row.rightHash !== null;
}

function isSameNodeReference(
  left: PrincipalHistoryNodeRow,
  right: PrincipalHistoryNodeRow,
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.referenceCount === right.referenceCount &&
    left.managed === right.managed &&
    left.leftHash === right.leftHash &&
    left.rightHash === right.rightHash
  );
}

/**
 * Register edges and store proof nodes in the given order, with the same
 * result as recording each node's edges one at a time, followed by any folded
 * root ownership edges. Reads the touched rows once, replays the bookkeeping,
 * and writes only the changed rows as multi-row upserts: a node whose stored
 * edges already match costs no write.
 */
export async function writePrincipalHistoryNodes(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
  nodes: readonly PrincipalHistoryIndexNode[],
  rootEdges?: PrincipalHistoryRootEdges | undefined,
): Promise<void> {
  if (nodes.length === 0 && !rootEdges) return;
  const loaded = new Map<string, PrincipalHistoryNodeRow | null>();
  await loadNodeReferences(
    tx,
    scope,
    [
      ...nodes.flatMap((node) => [node.hash, node.leftHash, node.rightHash]),
      ...(rootEdges ? [rootEdges.increment] : []),
      ...(rootEdges?.decrement ? [rootEdges.decrement] : []),
    ],
    loaded,
  );
  // An edge change releases the stored row's previous children.
  await loadNodeReferences(
    tx,
    scope,
    nodes.flatMap((node) => {
      const stored = loaded.get(node.hash);
      return [stored?.leftHash, stored?.rightHash].filter(
        (hash): hash is string => Boolean(hash),
      );
    }),
    loaded,
  );
  const replayed = replayNodeEdges(scope, nodes, loaded, rootEdges);
  const changed = [...replayed].flatMap(([hash, reference]) => {
    const before = loaded.get(hash);
    return reference && !(before && isSameNodeReference(before, reference))
      ? [reference]
      : [];
  });
  for (const batch of batches(changed, NODE_WRITE_BATCH_SIZE))
    await tx
      .insert(principalHistoryNodes)
      .values(batch)
      .onConflictDoUpdate({
        target: [principalHistoryNodes.scopeId, principalHistoryNodes.hash],
        set: {
          referenceCount: excludedValue(principalHistoryNodes.referenceCount),
          managed: excludedValue(principalHistoryNodes.managed),
          leftHash: excludedValue(principalHistoryNodes.leftHash),
          rightHash: excludedValue(principalHistoryNodes.rightHash),
        },
      })
      .run();
}

/**
 * Deletes one cascade iteration's obsolete rows, then releases their children: one decrement per distinct multiplicity, since
 * `max(count - k, 0)` equals k successive floored decrements. A child that is
 * itself obsolete in this iteration is deleted either way, as the per-node
 * loop deleted it before or after decrementing it.
 */
async function releaseObsoleteNodes(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
  obsolete: readonly PrincipalHistoryNodeRow[],
): Promise<void> {
  const hashes = obsolete.map((node) => node.hash);
  for (const batch of batches(hashes, SCOPED_HASH_BATCH_SIZE))
    await tx
      .delete(principalHistoryNodes)
      .where(
        and(
          eq(principalHistoryNodes.scopeId, scope.scopeId),
          eq(principalHistoryNodes.organizationId, scope.organizationId),
          inArray(principalHistoryNodes.hash, batch),
        ),
      )
      .run();
  const released = new Set(hashes);
  const multiplicity = new Map<string, number>();
  for (const node of obsolete)
    for (const hash of [node.leftHash, node.rightHash])
      if (hash && !released.has(hash))
        multiplicity.set(hash, (multiplicity.get(hash) ?? 0) + 1);
  const byCount = new Map<number, string[]>();
  for (const [hash, count] of multiplicity)
    byCount.set(count, [...(byCount.get(count) ?? []), hash]);
  for (const [count, children] of [...byCount].sort(([a], [b]) => a - b))
    for (const batch of batches(children.sort(), SCOPED_HASH_BATCH_SIZE))
      await tx
        .update(principalHistoryNodes)
        .set({
          // `count` is a positive integer computed here, inlined like the literal 1.
          referenceCount: sql`max(${principalHistoryNodes.referenceCount} - ${sql.raw(String(count))}, 0)`,
        })
        .where(
          and(
            eq(principalHistoryNodes.scopeId, scope.scopeId),
            eq(principalHistoryNodes.organizationId, scope.organizationId),
            inArray(principalHistoryNodes.hash, batch),
          ),
        )
        .run();
}

/** A bounded cascade releases only managed proof nodes with no live incoming edge. */
export async function reclaimPrincipalHistoryNodes(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
): Promise<number> {
  let reclaimed = 0;
  while (reclaimed < 64) {
    const obsolete = await tx
      .select()
      .from(principalHistoryNodes)
      .where(
        and(
          eq(principalHistoryNodes.scopeId, scope.scopeId),
          eq(principalHistoryNodes.organizationId, scope.organizationId),
          eq(principalHistoryNodes.managed, true),
          eq(principalHistoryNodes.referenceCount, 0),
        ),
      )
      .orderBy(asc(principalHistoryNodes.hash))
      .limit(64 - reclaimed);
    if (obsolete.length === 0) break;
    await releaseObsoleteNodes(tx, scope, obsolete);
    reclaimed += obsolete.length;
  }
  return reclaimed;
}
