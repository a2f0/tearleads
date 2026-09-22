import { and, eq, inArray, or, sql } from "drizzle-orm";
import { uniqueSortedStrings } from "../../documents/shared/readers";
import { documentIntentLinkTargets } from "../../sqlite/documentPlacementIntentSchema";
import {
  documentContainerProjection,
  documentMoveIntents,
  documentProjection,
} from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import {
  deleteContainerDocumentTombstoneHoldRowsForLinks,
  deleteContainerDocumentTombstoneHoldsForContainers,
} from "../documents/containerDocumentTombstoneHoldsPersistence";
import {
  DOCUMENT_LINK_INTENT_TYPE,
  DOCUMENT_MOVE_INTENT_TYPE,
} from "./documentMoveIntentPersistence";

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

  // The reassigned placements are asserted locally: a stale hold on the
  // destination would hide them, and holds on the vacated container have
  // nothing left to hide.
  const movedDocumentIds = (
    await tx
      .select({ documentId: documentContainerProjection.documentId })
      .from(documentContainerProjection)
      .where(eq(documentContainerProjection.containerId, fromContainerId))
  ).map((row) => row.documentId);
  await deleteContainerDocumentTombstoneHoldRowsForLinks(
    tx,
    movedDocumentIds.map((documentId) => ({
      containerIds: [toContainerId],
      documentId,
    })),
  );
  await deleteContainerDocumentTombstoneHoldsForContainers(tx, [
    fromContainerId,
  ]);
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
  const affectedIntents = await tx
    .select({
      documentId: documentMoveIntents.documentId,
      id: documentMoveIntents.id,
    })
    .from(documentMoveIntents)
    .where(
      and(
        inArray(documentMoveIntents.intentType, [
          DOCUMENT_MOVE_INTENT_TYPE,
          DOCUMENT_LINK_INTENT_TYPE,
        ]),
        or(
          eq(documentMoveIntents.sourceContainerId, fromContainerId),
          eq(documentMoveIntents.targetContainerId, fromContainerId),
          inArray(
            documentMoveIntents.id,
            tx
              .select({ id: documentIntentLinkTargets.intentId })
              .from(documentIntentLinkTargets)
              .where(
                and(
                  eq(documentIntentLinkTargets.containerId, fromContainerId),
                  eq(documentIntentLinkTargets.operation, "link"),
                ),
              ),
          ),
        ),
      ),
    );
  for (const intent of affectedIntents) {
    const id = crypto.randomUUID();
    const targets = await tx
      .select()
      .from(documentIntentLinkTargets)
      .where(eq(documentIntentLinkTargets.intentId, intent.id ?? ""));
    await tx
      .delete(documentIntentLinkTargets)
      .where(eq(documentIntentLinkTargets.intentId, intent.id ?? ""))
      .run();
    const retained = new Map(
      targets.map((target) => [target.containerId, target.operation]),
    );
    if (retained.get(fromContainerId) === "link") {
      retained.delete(fromContainerId);
      retained.set(toContainerId, "link");
    }
    if (retained.size)
      await tx
        .insert(documentIntentLinkTargets)
        .values(
          uniqueSortedStrings([...retained.keys()]).map((containerId) => ({
            intentId: id,
            containerId,
            operation: retained.get(containerId) ?? "link",
          })),
        )
        .run();
    await tx
      .update(documentMoveIntents)
      .set({
        id,
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
      .where(eq(documentMoveIntents.documentId, intent.documentId))
      .run();
  }
}

export async function reassignContainerDocumentsInTransaction(
  input: ContainerDocumentReassignmentInput,
): Promise<void> {
  await reassignDocumentLinksForContainer(input);
  await reassignPrimaryDocumentsForContainer(input);
  await reassignDocumentMoveIntentsForContainer(input);
}
