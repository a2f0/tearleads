import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegments,
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import type { DocumentUpdateRecord } from "@tearleads/loro/server";
import { eq, getTableColumns, inArray, sql } from "drizzle-orm";

/**
 * A committed update with its ciphertext. The update row holds the payload
 * itself, except for a baseline segment that was staged before the request
 * that committed it: that row's payload is the staged segment row with the
 * same update id.
 */
export type StoredDocumentUpdate = Omit<
  DocumentUpdateRecord,
  "encryptedData"
> & {
  readonly encryptedData: string;
};

/**
 * A committed update's ciphertext, wherever it is stored. It is read only
 * through an update row, joined by update id, so a segment that is staged
 * and not committed has no row to be read through and is never served.
 */
export const storedDocumentUpdatePayload = sql<
  string | null
>`coalesce(${documentUpdates.encryptedData}, ${documentBaselineSegments.encryptedData})`;

const storedDocumentUpdateColumns = {
  ...getTableColumns(documentUpdates),
  encryptedData: storedDocumentUpdatePayload,
};

/**
 * A committed update always has a payload: its own, or the staged row a
 * commit left for it, which only a purge of the document deletes. A row
 * without one is a broken database, never a client's fault.
 */
function withPayload(
  update: Omit<DocumentUpdateRecord, "encryptedData"> & {
    readonly encryptedData: string | null;
  },
): StoredDocumentUpdate {
  const { encryptedData } = update;
  if (encryptedData === null) {
    throw new Error("Document update payload is missing");
  }
  return { ...update, encryptedData };
}

/** Committed updates by id, each with its payload, in no particular order. */
export async function loadStoredDocumentUpdates(
  executor: DatabaseSession,
  ids: readonly string[],
): Promise<StoredDocumentUpdate[]> {
  if (ids.length === 0) return [];
  const rows = await executor
    .select(storedDocumentUpdateColumns)
    .from(documentUpdates)
    .leftJoin(
      documentBaselineSegments,
      eq(documentBaselineSegments.updateId, documentUpdates.id),
    )
    .where(inArray(documentUpdates.id, [...ids]));
  return rows.map(withPayload);
}

/** Only call after selecting the prefix bounded by response byte floors. */
export async function loadDocumentUpdatePageRows(
  executor: DatabaseSession,
  ids: readonly string[],
) {
  if (ids.length === 0) return [];
  const rows = await executor
    .select({
      update: storedDocumentUpdateColumns,
      writeHeader: {
        authorizationTargets: documentContentWriteHeaders.authorizationTargets,
        header: documentContentWriteHeaders.header,
        headerHash: documentContentWriteHeaders.headerHash,
      },
    })
    .from(documentUpdates)
    .leftJoin(
      documentContentWriteHeaders,
      eq(documentContentWriteHeaders.updateId, documentUpdates.id),
    )
    .leftJoin(
      documentBaselineSegments,
      eq(documentBaselineSegments.updateId, documentUpdates.id),
    )
    .where(inArray(documentUpdates.id, [...ids]));
  return rows.map((row) => ({ ...row, update: withPayload(row.update) }));
}

export type DocumentUpdatePageWriteHeader = NonNullable<
  Awaited<ReturnType<typeof loadDocumentUpdatePageRows>>[number]["writeHeader"]
>;
