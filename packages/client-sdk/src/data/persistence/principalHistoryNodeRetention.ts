import type { PrincipalHistoryIndexNode } from "@tearleads/crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { principalHistoryNodes } from "../sqlite/principalHistoryEvidenceSchema";
import { principalHistoryNodeReferences } from "../sqlite/principalHistoryNodeRetentionSchema";
import {
  sqliteInsertBatchSize,
  sqliteRowsPerStatement,
} from "../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../sqlite/sqliteUpsert";
import {
  decrementPrincipalHistoryNodeReference,
  type PrincipalHistoryNodeScope,
} from "./principalHistoryRootOwnership";

type PrincipalHistoryNodeReference =
  typeof principalHistoryNodeReferences.$inferSelect;

const REFERENCE_WRITE_BATCH_SIZE = sqliteInsertBatchSize(
  principalHistoryNodeReferences,
);
const NODE_WRITE_BATCH_SIZE = sqliteInsertBatchSize(principalHistoryNodes);
// The scope id binds once per lookup.
const HASH_LOOKUP_BATCH_SIZE = sqliteRowsPerStatement(1, 1);

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
  into: Map<string, PrincipalHistoryNodeReference | null>,
): Promise<void> {
  const missing = [...new Set(hashes)].filter((hash) => !into.has(hash));
  for (const batch of batches(missing, HASH_LOOKUP_BATCH_SIZE)) {
    for (const hash of batch) into.set(hash, null);
    const rows = await tx
      .select()
      .from(principalHistoryNodeReferences)
      .where(
        and(
          eq(principalHistoryNodeReferences.scopeId, scope.scopeId),
          inArray(principalHistoryNodeReferences.hash, batch),
        ),
      );
    for (const row of rows) into.set(row.hash, row);
  }
}

async function loadStoredNodeHashes(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
  hashes: readonly string[],
): Promise<Set<string>> {
  const stored = new Set<string>();
  for (const batch of batches([...new Set(hashes)], HASH_LOOKUP_BATCH_SIZE)) {
    const rows = await tx
      .select({ hash: principalHistoryNodes.hash })
      .from(principalHistoryNodes)
      .where(
        and(
          eq(principalHistoryNodes.scopeId, scope.scopeId),
          inArray(principalHistoryNodes.hash, batch),
        ),
      );
    for (const row of rows) stored.add(row.hash);
  }
  return stored;
}

/**
 * Replays the per-node edge bookkeeping in memory: increment inserts or adds
 * one, decrement floors at zero within the scope's organization, and an edge
 * change keeps the count while marking nodes first stored here as managed.
 */
function replayNodeEdges(
  scope: PrincipalHistoryNodeScope,
  nodes: readonly PrincipalHistoryIndexNode[],
  loaded: ReadonlyMap<string, PrincipalHistoryNodeReference | null>,
  storedNodeHashes: Set<string>,
): Map<string, PrincipalHistoryNodeReference | null> {
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
      const managed = previous?.managed || !storedNodeHashes.has(node.hash);
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
    storedNodeHashes.add(node.hash);
  }
  return references;
}

function isSameNodeReference(
  left: PrincipalHistoryNodeReference,
  right: PrincipalHistoryNodeReference,
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
 * result as recording each node's edges and then upserting it. Reads the
 * touched liveness rows once, replays the bookkeeping, and writes the changed
 * rows and the nodes as multi-row upserts.
 */
export async function writePrincipalHistoryNodes(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
  nodes: readonly PrincipalHistoryIndexNode[],
): Promise<void> {
  if (nodes.length === 0) return;
  const loaded = new Map<string, PrincipalHistoryNodeReference | null>();
  await loadNodeReferences(
    tx,
    scope,
    nodes.flatMap((node) => [node.hash, node.leftHash, node.rightHash]),
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
  const replayed = replayNodeEdges(
    scope,
    nodes,
    loaded,
    await loadStoredNodeHashes(
      tx,
      scope,
      nodes.map((node) => node.hash),
    ),
  );
  const changed = [...replayed].flatMap(([hash, reference]) => {
    const before = loaded.get(hash);
    return reference && !(before && isSameNodeReference(before, reference))
      ? [reference]
      : [];
  });
  for (const batch of batches(changed, REFERENCE_WRITE_BATCH_SIZE))
    await tx
      .insert(principalHistoryNodeReferences)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          principalHistoryNodeReferences.scopeId,
          principalHistoryNodeReferences.hash,
        ],
        set: {
          referenceCount: excludedValue(
            principalHistoryNodeReferences.referenceCount,
          ),
          managed: excludedValue(principalHistoryNodeReferences.managed),
          leftHash: excludedValue(principalHistoryNodeReferences.leftHash),
          rightHash: excludedValue(principalHistoryNodeReferences.rightHash),
        },
      })
      .run();
  const nodeRows = new Map(
    nodes.map((node) => [
      node.hash,
      {
        ...scope,
        hash: node.hash,
        leftHash: node.leftHash,
        rightHash: node.rightHash,
      },
    ]),
  );
  for (const batch of batches([...nodeRows.values()], NODE_WRITE_BATCH_SIZE))
    await tx
      .insert(principalHistoryNodes)
      .values(batch)
      .onConflictDoUpdate({
        target: [principalHistoryNodes.scopeId, principalHistoryNodes.hash],
        set: {
          organizationId: excludedValue(principalHistoryNodes.organizationId),
          leftHash: excludedValue(principalHistoryNodes.leftHash),
          rightHash: excludedValue(principalHistoryNodes.rightHash),
        },
      })
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
      .from(principalHistoryNodeReferences)
      .where(
        and(
          eq(principalHistoryNodeReferences.scopeId, scope.scopeId),
          eq(
            principalHistoryNodeReferences.organizationId,
            scope.organizationId,
          ),
          eq(principalHistoryNodeReferences.managed, true),
          eq(principalHistoryNodeReferences.referenceCount, 0),
        ),
      )
      .orderBy(asc(principalHistoryNodeReferences.hash))
      .limit(64 - reclaimed);
    if (obsolete.length === 0) break;
    for (const node of obsolete) {
      await tx
        .delete(principalHistoryNodes)
        .where(
          and(
            eq(principalHistoryNodes.scopeId, scope.scopeId),
            eq(principalHistoryNodes.organizationId, scope.organizationId),
            eq(principalHistoryNodes.hash, node.hash),
          ),
        )
        .run();
      await tx
        .delete(principalHistoryNodeReferences)
        .where(
          and(
            eq(principalHistoryNodeReferences.scopeId, scope.scopeId),
            eq(principalHistoryNodeReferences.hash, node.hash),
          ),
        )
        .run();
      for (const hash of [node.leftHash, node.rightHash])
        if (hash) await decrementPrincipalHistoryNodeReference(tx, scope, hash);
      reclaimed += 1;
    }
  }
  return reclaimed;
}
