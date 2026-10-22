import { and, eq, inArray, isNull } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
import {
  documentContainerProjection,
  documentProjection,
  documents,
} from "../../sqlite/schema";
import { SQLITE_BOUND_VARIABLE_BUDGET } from "../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";

// Leave room for the fixed binds each statement adds beside its id list.
const ID_BATCH_SIZE = SQLITE_BOUND_VARIABLE_BUDGET - 8;

function batches<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += ID_BATCH_SIZE) {
    result.push(values.slice(index, index + ID_BATCH_SIZE));
  }
  return result;
}

/**
 * Local ids of the documents whose every placement is one of `containerIds`.
 * A document also placed in a container outside the set stays: removing these
 * containers must not take a document another folder still shows.
 */
export async function listDocumentLocalIdsPlacedOnlyIn(
  execSql: ExecSql,
  containerIds: readonly string[],
): Promise<string[]> {
  const targets = new Set(containerIds);
  if (targets.size === 0) return [];
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const placedDocumentIds = new Set<string>();
  for (const batch of batches([...targets])) {
    const rows = await db
      .select({ documentId: documentContainerProjection.documentId })
      .from(documentContainerProjection)
      .where(inArray(documentContainerProjection.containerId, batch));
    for (const row of rows) placedDocumentIds.add(row.documentId);
  }

  const exclusiveDocumentIds = new Set(placedDocumentIds);
  for (const batch of batches([...placedDocumentIds])) {
    const rows = await db
      .select({
        containerId: documentContainerProjection.containerId,
        documentId: documentContainerProjection.documentId,
      })
      .from(documentContainerProjection)
      .where(inArray(documentContainerProjection.documentId, batch));
    for (const row of rows) {
      if (!targets.has(row.containerId)) {
        exclusiveDocumentIds.delete(row.documentId);
      }
    }
  }

  const localIds: string[] = [];
  for (const batch of batches([...exclusiveDocumentIds])) {
    const rows = await db
      .select({ localId: documents.localId })
      .from(documents)
      .where(
        and(
          eq(documents.appKind, DOCUMENTS_APP_KIND),
          inArray(documents.documentId, batch),
        ),
      );
    for (const row of rows) localIds.push(row.localId);
  }
  return localIds.sort();
}

/**
 * Local ids of an organization's documents no container holds any more. A
 * removed container leaves its documents attributed to its organization, so a
 * later pass can still find them.
 */
export async function listDetachedOrganizationDocumentLocalIds(
  execSql: ExecSql,
  organizationId: string,
): Promise<string[]> {
  const rows = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({ localId: documentProjection.localId })
    .from(documentProjection)
    .where(
      and(
        isNull(documentProjection.containerId),
        eq(documentProjection.organizationId, organizationId),
      ),
    );
  return rows
    .flatMap((row) => (row.localId === null ? [] : [row.localId]))
    .sort();
}
