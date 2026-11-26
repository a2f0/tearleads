import { encodeVersionVector, satisfiesVersionVector } from "@tearleads/loro";
import type { LoadedDocumentRecord } from "../../../../workflows/documents";
import type { DocumentStoreState } from "../state";

/**
 * The store's loaded remote record, for telling whether another runtime that
 * shares the database has saved content this store's document lacks. Null
 * for a store with no record, no document in memory, or no server document.
 *
 * The comparison reads the live document, not the record: the question is
 * what this runtime holds in memory. A save of this store's own that is
 * still in flight has already written its frontier to disk while the record
 * still names the earlier one, and the document holds everything that save
 * wrote.
 */
export function describeLoadedDocumentRecord(
  state: DocumentStoreState,
): LoadedDocumentRecord | null {
  if (!state.record?.documentId || state.doc === null) return null;
  return {
    localId: state.localId,
    lacks: (frontier) => {
      const { doc, record } = state;
      if (!record?.documentId || doc === null) return false;
      return !satisfiesVersionVector(encodeVersionVector(doc), frontier);
    },
  };
}
