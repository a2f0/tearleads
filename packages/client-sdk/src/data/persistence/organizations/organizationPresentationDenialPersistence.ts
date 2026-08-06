import { and, eq } from "drizzle-orm";
import { organizationPresentationDenials } from "../../sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../sqlite/organizationReadModelTableRegistry";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureSqlTables } from "../../sqlite/sqlTableSchema";

type OrganizationPresentationDenialProjection = "readModel" | "usage";

interface OrganizationPresentationDenialScope {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}

/**
 * Durably record a server denial before the revoked projection rows are
 * purged. The marker is what keeps a failed purge plus an offline restart
 * from serving the revoked projection; it is cleared only when an
 * authoritative reconcile stores fresh server state for the same scope.
 */
export async function recordOrganizationPresentationDenials(
  scope: OrganizationPresentationDenialScope,
  projections: readonly OrganizationPresentationDenialProjection[],
): Promise<void> {
  await ensureSqlTables(scope.execSql, organizationReadModelTables);
  const deniedAt = new Date().toISOString();
  await getClientSQLitePersistenceRuntime(scope.execSql).transaction(
    async (tx) => {
      for (const projection of new Set(projections)) {
        await tx
          .insert(organizationPresentationDenials)
          .values({
            organizationId: scope.organizationId,
            requesterUserId: scope.requesterUserId,
            projection,
            deniedAt,
          })
          .onConflictDoUpdate({
            target: [
              organizationPresentationDenials.organizationId,
              organizationPresentationDenials.requesterUserId,
              organizationPresentationDenials.projection,
            ],
            set: { deniedAt },
          })
          .run();
      }
    },
  );
}

export async function hasOrganizationPresentationDenial(
  scope: OrganizationPresentationDenialScope,
  projection: OrganizationPresentationDenialProjection,
): Promise<boolean> {
  await ensureSqlTables(scope.execSql, organizationReadModelTables);
  const rows = await getClientSQLitePersistenceRuntime(scope.execSql)
    .db.select({ projection: organizationPresentationDenials.projection })
    .from(organizationPresentationDenials)
    .where(
      and(
        eq(
          organizationPresentationDenials.organizationId,
          scope.organizationId,
        ),
        eq(
          organizationPresentationDenials.requesterUserId,
          scope.requesterUserId,
        ),
        eq(organizationPresentationDenials.projection, projection),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function clearOrganizationPresentationDenialInTransaction(input: {
  readonly organizationId: string;
  readonly projection: OrganizationPresentationDenialProjection;
  readonly requesterUserId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  await input.tx
    .delete(organizationPresentationDenials)
    .where(
      and(
        eq(
          organizationPresentationDenials.organizationId,
          input.organizationId,
        ),
        eq(
          organizationPresentationDenials.requesterUserId,
          input.requesterUserId,
        ),
        eq(organizationPresentationDenials.projection, input.projection),
      ),
    )
    .run();
}
