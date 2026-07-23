import { eq } from "drizzle-orm";
import { organizationReadModelState } from "../../sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { ORGANIZATION_READ_MODEL_PROTOCOL_VERSION } from "./organizationReadModelProtocol";

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
 * Rows written by an older protocol version are skipped rather than trusted:
 * they survive until a projection load validates and purges them, and this read
 * runs outside that path, so an incompatible row's stale pointer could otherwise
 * resolve to a superseded document and be reported as the current name.
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
    .from(organizationReadModelState)
    .where(
      eq(
        organizationReadModelState.protocolVersion,
        ORGANIZATION_READ_MODEL_PROTOCOL_VERSION,
      ),
    );

  return new Map(
    rows.flatMap((row) =>
      row.profileDocumentId
        ? [[row.organizationId, row.profileDocumentId]]
        : [],
    ),
  );
}
