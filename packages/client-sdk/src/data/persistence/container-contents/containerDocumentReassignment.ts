import { and, eq, or, sql } from "drizzle-orm";
import {
  documentContainerProjection,
  documentMoveIntents,
  documentProjection,
} from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { DOCUMENT_MOVE_INTENT_TYPE } from "./documentMoveIntentPersistence";

interface ContainerDocumentReassignmentInput {
  readonly fromContainerId: string;
  readonly toContainerId: string;
  readonly tx: ClientSQLiteTransactionScope;
  readonly updatedAt: string;
}

async function reassignDocumentLinksForContainer(
  input: ContainerDocumentReassignmentInput,
): Promise<void> {
  const { fromContainerId, toContainerId, tx, updatedAt } = input;
  await tx.run(sql`
    INSERT INTO ${documentContainerProjection} (
      ${sql.raw("document_id")},
      ${sql.raw("container_id")},
      ${sql.raw("updated_at")}
    )
    SELECT
      ${documentContainerProjection.documentId},
      ${toContainerId},
      max(${documentContainerProjection.updatedAt}, ${updatedAt})
    FROM ${documentContainerProjection}
    WHERE ${documentContainerProjection.containerId} = ${fromContainerId}
    ON CONFLICT (
      ${sql.raw("document_id")},
      ${sql.raw("container_id")}
    ) DO UPDATE SET
      ${sql.raw("updated_at")} = max(
        ${sql.raw("updated_at")},
        excluded.${sql.raw("updated_at")}
      )
  `);

  await tx
    .delete(documentContainerProjection)
    .where(eq(documentContainerProjection.containerId, fromContainerId))
    .run();
}

async function reassignPrimaryDocumentsForContainer(
  input: ContainerDocumentReassignmentInput,
): Promise<void> {
  const { fromContainerId, toContainerId, tx, updatedAt } = input;
  await tx
    .update(documentProjection)
    .set({
      containerId: toContainerId,
      updatedAt: sql`max(${documentProjection.updatedAt}, ${updatedAt})`,
    })
    .where(eq(documentProjection.containerId, fromContainerId))
    .run();
}

async function reassignDocumentMoveIntentsForContainer(
  input: ContainerDocumentReassignmentInput,
): Promise<void> {
  const { fromContainerId, toContainerId, tx, updatedAt } = input;
  await tx
    .update(documentMoveIntents)
    .set({
      lastAttemptedAt: null,
      lastError: null,
      sourceContainerId: sql`CASE
        WHEN ${documentMoveIntents.sourceContainerId} = ${fromContainerId}
        THEN ${toContainerId}
        ELSE ${documentMoveIntents.sourceContainerId}
      END`,
      syncStatus: "pending",
      targetContainerId: sql`CASE
        WHEN ${documentMoveIntents.targetContainerId} = ${fromContainerId}
        THEN ${toContainerId}
        ELSE ${documentMoveIntents.targetContainerId}
      END`,
      updatedAt: sql`max(${documentMoveIntents.updatedAt}, ${updatedAt})`,
    })
    .where(
      and(
        eq(documentMoveIntents.intentType, DOCUMENT_MOVE_INTENT_TYPE),
        or(
          eq(documentMoveIntents.sourceContainerId, fromContainerId),
          eq(documentMoveIntents.targetContainerId, fromContainerId),
        ),
      ),
    )
    .run();
}

export async function reassignContainerDocumentsInTransaction(
  input: ContainerDocumentReassignmentInput,
): Promise<void> {
  await reassignDocumentLinksForContainer(input);
  await reassignPrimaryDocumentsForContainer(input);
  await reassignDocumentMoveIntentsForContainer(input);
}
