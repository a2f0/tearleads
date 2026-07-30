import {
  containerTables,
  documentProjectionTables,
  documentTables,
} from "../../data/sqlite/schema";
import { ensureSqlTables } from "../../data/sqlite/sqlSchema";
import type {
  ContainerContentsDocumentRuntimeTarget,
  ContainerDocumentPrimeHost,
  ContainerDocumentQueriesRuntime,
} from "./documentQueries/types";
import { requestDocumentRuntimeTargetSync } from "./documentRuntimeTargetSync";

const REMOTE_DOCUMENT_PROBE_TARGET_SQL = `
  SELECT
    stored.local_id AS local_id,
    stored.document_id AS document_id,
    projection.container_id AS container_id
  FROM documents stored
  INNER JOIN document_projection projection
    ON projection.local_id = stored.local_id
  LEFT JOIN containers owner
    ON owner.id = projection.container_id
  WHERE stored.app_kind = 'documents'
    AND stored.document_id IS NOT NULL
    AND COALESCE(owner.organization_id, projection.organization_id) = ?
    AND projection.document_kind NOT IN ('organization_profile')
  ORDER BY stored.local_id ASC
`;

async function listUndiscoveredRemoteDocumentTargets(input: {
  readonly listedDocumentIds: ReadonlySet<string>;
  readonly organizationId: string;
  readonly runtime: ContainerDocumentQueriesRuntime;
}): Promise<ContainerContentsDocumentRuntimeTarget[]> {
  await ensureSqlTables(input.runtime.infra.execSql, [
    ...containerTables,
    ...documentTables,
    ...documentProjectionTables,
  ]);
  const rows = await input.runtime.infra.execSql(
    REMOTE_DOCUMENT_PROBE_TARGET_SQL,
    [input.organizationId],
  );

  return rows.flatMap((row) => {
    const documentId = Reflect.get(row, "document_id");
    const localId = Reflect.get(row, "local_id");
    if (
      typeof documentId !== "string" ||
      typeof localId !== "string" ||
      input.listedDocumentIds.has(documentId)
    ) {
      return [];
    }

    const containerId = Reflect.get(row, "container_id");
    return [
      {
        documentId,
        localId,
        runtimeContainerId:
          typeof containerId === "string" ? containerId : null,
      },
    ];
  });
}

/**
 * Opens visible remote-backed local documents absent from every completed
 * initial container listing. Hidden system documents retain their specialized
 * synchronization paths. The ordinary document-sync pass owns the verdict:
 * coded document_not_found destroys, bare 404 remains non-destructive, and a
 * write-bearing 403 parks the local work exactly as it does for an opened doc.
 */
export async function probeUndiscoveredRemoteDocuments<TRuntime>(input: {
  readonly host: ContainerDocumentPrimeHost<TRuntime>;
  readonly listedDocumentIds: ReadonlySet<string>;
  readonly organizationId: string;
  readonly runtime: ContainerDocumentQueriesRuntime;
}): Promise<number> {
  const targets = await listUndiscoveredRemoteDocumentTargets(input);
  const requested = await requestDocumentRuntimeTargetSync({
    host: input.host,
    targets,
  });
  return requested.size;
}
