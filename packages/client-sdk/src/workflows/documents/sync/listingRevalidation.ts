/**
 * Reads a container listing owes the records of an ordinary document.
 *
 * A document whose lane a listing covers is not probed when its store loads
 * or its socket reconnects. Instead, a listing that shows the document with
 * more updates than a record's processed cursor covers, or with another
 * access head than the one the record's key bundle was issued under, owes
 * that record one read, written to `document_listing_revalidations` before
 * the listing is applied and the lane's watermark passes the row
 * (`oweListedDocumentReads`). A debt belongs to the record, so two records of
 * one document each owe and pay their own. A store reads its record's debt
 * when it loads and before each remote pull, and settles it only once the
 * cursor its completed pull saved covers the advertised count and the
 * manifest it saved is the advertised head or a later one: a replica that
 * lags the listing can answer without the edit or the head, and that debt
 * then waits for a later pull.
 */

import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentConstants";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  type DocumentListingRevalidation,
  DocumentListingRevalidationRepository,
  type ListedDocumentHead,
  type OwedDocumentRecord,
} from "../../../data/persistence/documents/documentListingRevalidationRepository";
import { readPersistedDocumentFrontiers } from "../../../data/persistence/documents/records/persistedDocumentFrontiers";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { isProcessedCursorWithheldForSync } from "./processedCursor";

export type {
  DocumentListingRevalidation,
  ListedDocumentHead,
  OwedDocumentRecord,
} from "../../../data/persistence/documents/documentListingRevalidationRepository";

/**
 * Owes a read, durably, to each record of a listed document that the
 * listing shows behind: its processed cursor does not cover the listed
 * count, or its key bundle was issued under another access head. Returns
 * the documents owed. It must run before the listing is applied, which can
 * drop that key bundle, and a document lane's watermark may pass a listed
 * row only after this ran for it.
 */
export async function oweListedDocumentReadsBehindListing(
  execSql: ExecSql,
  listed: ReadonlyArray<ListedDocumentHead>,
): Promise<ReadonlyArray<string>> {
  const revalidations = new DocumentListingRevalidationRepository(execSql);
  const behind = await revalidations.listBehindListing(
    listed,
    documentVerdictJudge(),
  );
  await revalidations.request(behind);
  return [...new Set(behind.map(({ documentId }) => documentId))];
}

/** The read a listing still owes `record`, if any. */
export function findOwedDocumentListingRead(
  execSql: ExecSql,
  record: OwedDocumentRecord,
): Promise<DocumentListingRevalidation | null> {
  return new DocumentListingRevalidationRepository(execSql).find(record);
}

/** Every record a listing still owes a read. */
export function listOwedDocumentListingReads(
  execSql: ExecSql,
): Promise<ReadonlyArray<OwedDocumentRecord>> {
  return new DocumentListingRevalidationRepository(execSql).listOwed();
}

/**
 * Forgets the reads owed by records that no longer hold their document.
 * Nothing reads such a debt, so a catch-up clears them once its own reads
 * are requested.
 */
export function forgetUnheldDocumentListingReads(
  execSql: ExecSql,
): Promise<void> {
  return new DocumentListingRevalidationRepository(execSql).forgetUnheld();
}

/** A loaded store's record, as far as telling whether it lags the disk. */
export interface LoadedDocumentRecord {
  readonly localId: string;
  /** Whether the store's document in memory lacks content `frontier` holds. */
  readonly lacks: (frontier: string) => boolean;
}

/**
 * The loaded records whose stores lack content their record has on disk,
 * by local id. Runtimes that share one database (two tabs, say) share each
 * record, its processed cursor and its listing debt, but each keeps its own
 * copy of an open document in memory. Once another runtime's pull has saved
 * an edit and settled its debt, no listing names the document to this
 * runtime again, so a catch-up ends by asking each such store for one pull.
 * That pull cites the store's own version: the shared cursor was recorded
 * with a version the store does not cover, so it is not sent.
 */
export async function listLoadedRecordsSavedElsewhere(
  execSql: ExecSql,
  loaded: ReadonlyArray<LoadedDocumentRecord>,
): Promise<ReadonlySet<string>> {
  const frontiers = await readPersistedDocumentFrontiers(
    execSql,
    DOCUMENTS_APP_KIND,
    loaded.map(({ localId }) => localId),
  );
  const behind = new Set<string>();
  for (const { lacks, localId } of loaded) {
    const frontier = frontiers.get(localId);
    if (frontier !== undefined && frontier !== "" && lacks(frontier)) {
      behind.add(localId);
    }
  }
  return behind;
}

/**
 * Whether a record owes a pull no listing will ask for: it holds a processed
 * cursor that its next pull withholds. A listing owes a read only to a row
 * it is served, and a row behind its lane's watermark is not served again.
 * So a record whose cursor stopped counting after its last pull (the device
 * now runs another judge, or its content was restored to an older version)
 * would wait for the document's next change to be judged again.
 */
export function isDocumentProcessedCursorWithheld(
  execSql: ExecSql,
  input: {
    readonly documentId: string;
    readonly frontier: string;
    readonly localId: string;
  },
): Promise<boolean> {
  return isProcessedCursorWithheldForSync(execSql, {
    documentId: input.documentId,
    frontier: input.frontier,
    scope: { appKind: DOCUMENTS_APP_KIND, localId: input.localId },
  });
}

/**
 * Settles the debt a completed pull observed before its request, if the
 * record that owes it now pays it, as its record and cursor stand on disk:
 * its processed cursor covers the count the listing advertised, and the
 * manifest its last pull saved is the head the listing showed or a later
 * one. Returns whether the debt is settled.
 */
export function settleCoveredDocumentListingRead(
  execSql: ExecSql,
  owed: DocumentListingRevalidation,
): Promise<boolean> {
  return new DocumentListingRevalidationRepository(execSql).settle(
    owed,
    documentVerdictJudge(),
  );
}
