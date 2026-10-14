import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, ne, type SQL, sql } from "drizzle-orm";

/**
 * Current document links are the link projection of each document's current
 * manifest head: the same signed `linkedContainerIds` authorization reads,
 * with no separately materialized copy to keep in step.
 */
function currentDocumentHead(): SQL | undefined {
  return and(
    eq(
      accessManifestHeads.manifestHash,
      accessManifestDocumentLinkProjection.manifestHash,
    ),
    eq(accessManifestHeads.objectKind, "document"),
    eq(
      accessManifestHeads.objectId,
      accessManifestDocumentLinkProjection.documentId,
    ),
  );
}

/** Containers the document's current manifest head links, sorted. */
export async function listCurrentDocumentContainerIds(
  documentId: string,
  executor: DatabaseSession,
): Promise<string[]> {
  const rows = await executor
    .select({ containerId: accessManifestDocumentLinkProjection.containerId })
    .from(accessManifestDocumentLinkProjection)
    .innerJoin(accessManifestHeads, currentDocumentHead())
    .where(eq(accessManifestDocumentLinkProjection.documentId, documentId))
    .orderBy(accessManifestDocumentLinkProjection.containerId);
  return rows.map((row) => row.containerId);
}

/** Documents whose current manifest head links any of these containers. */
export async function listDocumentsCurrentlyLinkedToContainers(
  containerIds: readonly string[],
  executor: DatabaseSession,
): Promise<string[]> {
  if (containerIds.length === 0) return [];
  const rows = await executor
    .select({ documentId: accessManifestDocumentLinkProjection.documentId })
    .from(accessManifestDocumentLinkProjection)
    .innerJoin(accessManifestHeads, currentDocumentHead())
    .where(
      inArray(accessManifestDocumentLinkProjection.containerId, [
        ...containerIds,
      ]),
    );
  return [...new Set(rows.map((row) => row.documentId))];
}

/**
 * SQL condition: some document other than `exceptDocumentId` currently links
 * `containerId`. For a guard inside a larger statement.
 */
export function containerHasCurrentDocumentLink(input: {
  readonly containerId: SQL;
  readonly exceptDocumentId: SQL;
}): SQL {
  return sql`exists (
    select 1
    from ${accessManifestDocumentLinkProjection}
    inner join ${accessManifestHeads} on ${currentDocumentHead()}
    where ${accessManifestDocumentLinkProjection.containerId} = ${input.containerId}
      and ${accessManifestDocumentLinkProjection.documentId} <> ${input.exceptDocumentId}
  )`;
}

/** Whether a document other than `exceptDocumentId` currently links it. */
export async function hasCurrentDocumentLink(input: {
  readonly containerId: string;
  readonly exceptDocumentId: string;
  readonly executor: DatabaseSession;
}): Promise<boolean> {
  const [row] = await input.executor
    .select({ documentId: accessManifestDocumentLinkProjection.documentId })
    .from(accessManifestDocumentLinkProjection)
    .innerJoin(accessManifestHeads, currentDocumentHead())
    .where(
      and(
        eq(accessManifestDocumentLinkProjection.containerId, input.containerId),
        ne(
          accessManifestDocumentLinkProjection.documentId,
          input.exceptDocumentId,
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}
