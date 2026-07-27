import { organizationReadModelState } from "../../sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

/**
 * Every locally projected organization's pointer to its organization_profile
 * document, keyed by organization id.
 *
 * This is the only container-independent handle on that document. Callers that
 * need an org's display name from local state cannot rely on where the document
 * is linked: the provisioner writes it under a deterministic local alias into
 * the organization-metadata container, while a device that only *synced* it
 * (identity recovery, another member) keys it under the server documentId in
 * whichever container the grant arrived through.
 *
 * The local schema stores only the current read-model contract, so every state
 * row is eligible to provide its profile-document pointer.
 */
export async function loadOrganizationProfileDocumentIds(
  execSql: ExecSql,
): Promise<Map<string, string>> {
  await ensureSqlTables(execSql, organizationReadModelTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      organizationId: organizationReadModelState.organizationId,
      profileDocumentId: organizationReadModelState.profileDocumentId,
    })
    .from(organizationReadModelState);

  return new Map(
    rows.flatMap((row) =>
      row.profileDocumentId
        ? [[row.organizationId, row.profileDocumentId]]
        : [],
    ),
  );
}
