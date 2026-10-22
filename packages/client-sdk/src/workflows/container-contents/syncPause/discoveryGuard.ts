import type { DocumentSummary } from "../../../data/documents/documentSummary";
import { upsertDiscoveredDocuments } from "../../../data/persistence/documents/documentsPersistence";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

type DiscoveredDocumentInput = Parameters<typeof upsertDiscoveredDocuments>[1];

/**
 * Stores a discovery listing unless the container's organization was paused
 * while the listing was in flight. The check holds the same SQLite mutation
 * lock as the write, so a pause cleanup that already ran is never undone by a
 * stale listing.
 */
export function upsertDiscoveredDocumentsUnlessPaused(input: {
  readonly execSql: ExecSql;
  readonly inputs: DiscoveredDocumentInput;
  readonly isPaused: () => boolean;
  readonly upsert?: typeof upsertDiscoveredDocuments | undefined;
}): Promise<DocumentSummary[]> {
  const upsert = input.upsert ?? upsertDiscoveredDocuments;
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) =>
    input.isPaused() ? [] : upsert(lockedExecSql, input.inputs),
  );
}
