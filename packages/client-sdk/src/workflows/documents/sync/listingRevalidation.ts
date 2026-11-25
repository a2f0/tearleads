/**
 * Reads a container listing owes an ordinary document.
 *
 * A document whose lane a listing covers is not probed when its store loads
 * or its socket reconnects. Instead, a listing that shows the document with
 * more updates than this device's processed cursor covers, or with another
 * access head than the one its record's key bundle was issued under, owes it
 * one read, written to `document_listing_revalidations` before the listing
 * is applied and the lane's watermark passes the row
 * (`oweListedDocumentReads`). A store reads its document's debt when it
 * loads and before each remote pull, and settles it only once
 * the cursor its completed pull saved covers the advertised count: a replica
 * that lags the listing can answer without the edit, and that debt then
 * waits for a later pull.
 */

import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentConstants";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  type DocumentListingRevalidation,
  DocumentListingRevalidationRepository,
  type ListedDocumentHead,
} from "../../../data/persistence/documents/documentListingRevalidationRepository";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { readProcessedUpdateCountForSync } from "./processedCursor";

export type {
  DocumentListingRevalidation,
  ListedDocumentHead,
} from "../../../data/persistence/documents/documentListingRevalidationRepository";

/**
 * Owes a read, durably, to each listed document this device holds behind the
 * listing: its processed cursor does not cover the listed count, or its
 * record's key bundle was issued under another access head. Returns the
 * documents owed. It must run before the listing is applied, which can drop
 * that key bundle, and a document lane's watermark may pass a listed row
 * only after this ran for it.
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
  return behind.map(({ documentId }) => documentId);
}

/** The read a listing still owes `documentId`, if any. */
export function findOwedDocumentListingRead(
  execSql: ExecSql,
  documentId: string,
): Promise<DocumentListingRevalidation | null> {
  return new DocumentListingRevalidationRepository(execSql).find(documentId);
}

/** Every document a listing still owes a read. */
export function listOwedDocumentListingReads(
  execSql: ExecSql,
): Promise<ReadonlyArray<string>> {
  return new DocumentListingRevalidationRepository(
    execSql,
  ).listOwedDocumentIds();
}

/**
 * Settles the debt a completed pull observed before its request, if the
 * processed cursor that pull left covers the count the listing advertised.
 * Returns whether the debt is settled. `frontier` is the content frontier the
 * pull's save recorded, under which the cursor must still be sendable.
 */
export async function settleCoveredDocumentListingRead(
  execSql: ExecSql,
  input: {
    readonly frontier: string;
    readonly localId: string;
    readonly owed: DocumentListingRevalidation;
  },
): Promise<boolean> {
  // A debt at count zero is owed for a moved access head alone: the server
  // holds no update a cursor could count, so the completed pull pays it.
  if (input.owed.advertisedUpdateCount > 0) {
    const processed =
      input.frontier === ""
        ? null
        : await readProcessedUpdateCountForSync(execSql, {
            documentId: input.owed.documentId,
            frontier: input.frontier,
            scope: { appKind: DOCUMENTS_APP_KIND, localId: input.localId },
          });
    if (processed === null || processed < input.owed.advertisedUpdateCount) {
      return false;
    }
  }
  await new DocumentListingRevalidationRepository(execSql).settle(input.owed);
  return true;
}
