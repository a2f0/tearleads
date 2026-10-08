import type { PrincipalHistoryIndexNode } from "@tearleads/crypto";
import { and, asc, eq } from "drizzle-orm";
import { principalHistoryNodes } from "../sqlite/principalHistoryEvidenceSchema";
import { principalHistoryNodeReferences } from "../sqlite/principalHistoryNodeRetentionSchema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";
import {
  decrementPrincipalHistoryNodeReference,
  incrementPrincipalHistoryNodeReference,
  type PrincipalHistoryNodeScope,
} from "./principalHistoryRootOwnership";

/** Register edges before inserting their proof node, preserving pre-index evidence. */
export async function recordPrincipalHistoryNodeEdges(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
  node: PrincipalHistoryIndexNode,
) {
  const key = and(
    eq(principalHistoryNodeReferences.scopeId, scope.scopeId),
    eq(principalHistoryNodeReferences.hash, node.hash),
  );
  const [previous] = await tx
    .select()
    .from(principalHistoryNodeReferences)
    .where(key)
    .limit(1);
  if (
    previous?.leftHash === node.leftHash &&
    previous.rightHash === node.rightHash
  )
    return;
  const [existing] = await tx
    .select({ hash: principalHistoryNodes.hash })
    .from(principalHistoryNodes)
    .where(
      and(
        eq(principalHistoryNodes.scopeId, scope.scopeId),
        eq(principalHistoryNodes.hash, node.hash),
      ),
    )
    .limit(1);
  for (const hash of [node.leftHash, node.rightHash])
    await incrementPrincipalHistoryNodeReference(tx, scope, hash);
  await tx
    .insert(principalHistoryNodeReferences)
    .values({
      ...scope,
      ...node,
      referenceCount: previous?.referenceCount ?? 0,
      managed: previous?.managed || !existing,
    })
    .onConflictDoUpdate({
      target: [
        principalHistoryNodeReferences.scopeId,
        principalHistoryNodeReferences.hash,
      ],
      set: {
        leftHash: node.leftHash,
        rightHash: node.rightHash,
        managed: previous?.managed || !existing,
      },
    })
    .run();
  for (const hash of [previous?.leftHash, previous?.rightHash])
    if (hash) await decrementPrincipalHistoryNodeReference(tx, scope, hash);
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
