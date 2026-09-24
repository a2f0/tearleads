import { inArray, sql } from "drizzle-orm";
import {
  documentDiscoveryHeads,
  documentDiscoverySequence,
  pendingDocumentDiscoveries,
} from "../../sqlite/documentDiscoveryEvidenceSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

export async function isDocumentDiscoveryGenerationCurrent(
  db: ClientSQLiteTransactionScope,
  generation: number,
): Promise<boolean> {
  const [row] = await db.select().from(documentDiscoverySequence).limit(1);
  return generation > (row?.invalidatedThrough ?? 0);
}

export async function clearDocumentDiscoveryEvidenceOnRemoteReset(
  tx: ClientSQLiteTransactionScope,
  input: { containerIds: readonly string[]; documentIds: readonly string[] },
): Promise<void> {
  // Cache eviction is global because the request sequence is process-wide. It
  // only costs a re-verification in other organizations; their queues survive.
  await tx.delete(documentDiscoveryHeads).run();
  // Keep local request ordinals monotone. Reusing ordinals would let a request
  // started before the trust reset repopulate the verified cache afterward.
  await tx
    .update(documentDiscoverySequence)
    .set({
      invalidatedThrough: sql`${documentDiscoverySequence.generation}`,
    })
    .run();
  for (const [ids, column] of [
    [input.containerIds, pendingDocumentDiscoveries.containerId],
    [input.documentIds, pendingDocumentDiscoveries.documentId],
  ] as const) {
    for (let offset = 0; offset < ids.length; offset += 400) {
      await tx
        .delete(pendingDocumentDiscoveries)
        .where(inArray(column, ids.slice(offset, offset + 400)))
        .run();
    }
  }
}
