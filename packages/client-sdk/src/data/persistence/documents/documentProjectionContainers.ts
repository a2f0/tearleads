import { eq, sql } from "drizzle-orm";
import { documentProjection } from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

// The primary container of each projected document, rewritten inside Container
// Contents' transactions when a folder is reassigned or its tree repaired.

/** Moves every document whose primary container is `fromContainerId`. */
export async function reassignDocumentProjectionContainerInTransaction(
  tx: ClientSQLiteTransactionScope,
  input: {
    readonly fromContainerId: string;
    readonly toContainerId: string;
    readonly updatedAt: string;
  },
): Promise<void> {
  await tx
    .update(documentProjection)
    .set({
      containerId: input.toContainerId,
      updatedAt: sql`max(${documentProjection.updatedAt}, ${input.updatedAt})`,
    })
    .where(eq(documentProjection.containerId, input.fromContainerId))
    .run();
}

/** Sets one projected document's primary container, and its organization if given. */
export async function setDocumentProjectionContainerInTransaction(
  tx: ClientSQLiteTransactionScope,
  localId: string,
  input: {
    readonly containerId: string | null;
    readonly organizationId?: string | undefined;
    readonly updatedAt: string;
  },
): Promise<void> {
  await tx
    .update(documentProjection)
    .set({
      containerId: input.containerId,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      updatedAt: input.updatedAt,
    })
    .where(eq(documentProjection.localId, localId))
    .run();
}
