import { HIDDEN_DOCUMENT_SUMMARY_KINDS } from "../../data/documentSummary";
import {
  containerTables,
  documentContainerProjectionTables,
  documentProjectionTables,
  documentTables,
} from "../../data/sqlite/schema";
import { ensureSqlTables } from "../../data/sqlite/sqlSchema";
import type {
  ContainerContentsDocumentRuntimeTarget,
  ContainerDocumentProbeHost,
  ContainerDocumentQueriesRuntime,
} from "./documentQueries/types";
import { requestRemoteDocumentRuntimeTargetSync } from "./documentRuntimeTargetSync";

const DOCUMENT_HYDRATION_PROBE_BATCH_SIZE = 8;

interface DocumentHydrationProbeBatchResult {
  readonly done: boolean;
  readonly nextCursor: string | null;
  readonly requestedCount: number;
}

type RemoteDocumentProbeTarget = Omit<
  ContainerContentsDocumentRuntimeTarget,
  "documentId"
> & { readonly documentId: string };

function valuePlaceholders(values: ReadonlyArray<unknown>): string {
  return values.map(() => "?").join(", ");
}

function readProbeTarget(row: unknown): RemoteDocumentProbeTarget {
  if (row === null || (typeof row !== "object" && typeof row !== "function")) {
    throw new Error("Document hydration probe returned an invalid target");
  }
  const documentId = Reflect.get(row, "document_id");
  const localId = Reflect.get(row, "local_id");
  const runtimeContainerId = Reflect.get(row, "container_id");
  if (
    typeof documentId !== "string" ||
    typeof localId !== "string" ||
    typeof runtimeContainerId !== "string"
  ) {
    throw new Error("Document hydration probe returned an invalid target");
  }
  return { documentId, localId, runtimeContainerId };
}

async function listRemoteDocumentProbeBatch(input: {
  readonly afterLocalId: string | null;
  readonly listedContainerIds: ReadonlySet<string>;
  readonly runtime: ContainerDocumentQueriesRuntime;
}): Promise<RemoteDocumentProbeTarget[]> {
  const containerIds = [...input.listedContainerIds];
  if (containerIds.length === 0) {
    return [];
  }

  await ensureSqlTables(input.runtime.infra.execSql, [
    ...containerTables,
    ...documentTables,
    ...documentProjectionTables,
    ...documentContainerProjectionTables,
  ]);
  const rows = await input.runtime.infra.execSql(
    `
      SELECT
        stored.local_id AS local_id,
        stored.document_id AS document_id,
        MIN(link.container_id) AS container_id
      FROM documents stored
      INNER JOIN document_projection projection
        ON projection.local_id = stored.local_id
      INNER JOIN document_container_projection link
        ON link.document_id = stored.document_id
      INNER JOIN containers owner
        ON owner.id = link.container_id
      WHERE stored.app_kind = 'documents'
        AND stored.document_id IS NOT NULL
        AND (? IS NULL OR stored.local_id > ?)
        AND link.container_id IN (${valuePlaceholders(containerIds)})
        AND projection.document_kind NOT IN (${valuePlaceholders(
          HIDDEN_DOCUMENT_SUMMARY_KINDS,
        )})
      GROUP BY stored.local_id, stored.document_id
      ORDER BY stored.local_id ASC
      LIMIT ?
    `,
    [
      input.afterLocalId,
      input.afterLocalId,
      ...containerIds,
      ...HIDDEN_DOCUMENT_SUMMARY_KINDS,
      DOCUMENT_HYDRATION_PROBE_BATCH_SIZE,
    ],
  );
  return rows.map(readProbeTarget);
}

/**
 * Opens at most one bounded batch of visible, remote-backed local documents
 * linked to an authoritatively listed container but absent from every full
 * listing. Each store's ordinary sync pass owns its coded-404/403 verdict.
 */
export async function probeUndiscoveredRemoteDocumentBatch<TRuntime>(input: {
  readonly afterLocalId: string | null;
  readonly host: ContainerDocumentProbeHost<TRuntime>;
  readonly listedContainerIds: ReadonlySet<string>;
  readonly listedDocumentIds: ReadonlySet<string>;
  readonly runtime: ContainerDocumentQueriesRuntime;
}): Promise<DocumentHydrationProbeBatchResult> {
  const scanned = await listRemoteDocumentProbeBatch(input);
  const requested = await requestRemoteDocumentRuntimeTargetSync({
    host: input.host,
    targets: scanned.filter(
      (target) => !input.listedDocumentIds.has(target.documentId),
    ),
  });
  const done = scanned.length < DOCUMENT_HYDRATION_PROBE_BATCH_SIZE;
  return {
    done,
    nextCursor: done ? null : (scanned.at(-1)?.localId ?? null),
    requestedCount: requested.size,
  };
}
