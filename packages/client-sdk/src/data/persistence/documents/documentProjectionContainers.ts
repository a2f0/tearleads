import { eq, sql } from "drizzle-orm";
import { documentProjection } from "../../sqlite/schema/documentProjectionSchema";
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

/** Reuses the two update shapes only within the caller's transaction. */
export function createDocumentProjectionContainerUpdater(
  tx: ClientSQLiteTransactionScope,
) {
  const prepare = (withOrganization: boolean) =>
    tx
      .update(documentProjection)
      .set({
        containerId: sql`${sql.placeholder("containerId")}`,
        ...(withOrganization
          ? { organizationId: sql`${sql.placeholder("organizationId")}` }
          : {}),
        updatedAt: sql`${sql.placeholder("updatedAt")}`,
      })
      .where(eq(documentProjection.localId, sql.placeholder("localId")))
      .prepare();
  let withOrganization: ReturnType<typeof prepare> | undefined;
  let withoutOrganization: ReturnType<typeof prepare> | undefined;

  return async (
    localId: string,
    input: {
      readonly containerId: string | null;
      readonly organizationId?: string | undefined;
      readonly updatedAt: string;
    },
  ): Promise<void> => {
    // An absent/empty attribution must omit the column, not overwrite it.
    // Prepare lazily at the first matching row; keep every execution ordered.
    if (input.organizationId) {
      withOrganization ??= prepare(true);
      await withOrganization.run({ localId, ...input });
    } else {
      withoutOrganization ??= prepare(false);
      await withoutOrganization.run({ localId, ...input });
    }
  };
}
