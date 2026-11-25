import { encodeVersionVector, satisfiesVersionVector } from "@tearleads/loro";
import type { LoadedDocumentRecord } from "../../../../workflows/documents";
import type { DocumentStoreState } from "../state";

/**
 * The store's loaded remote record, for telling whether another runtime that
 * shares the database has saved content this store's document lacks. Null
 * for a store with no record, no document in memory, or no server document.
 *
 * The comparison reads the live document, not the record. A save of this
 * store's own that is still in flight has already written its frontier to
 * disk, and the document in memory holds everything that save wrote. And a
 * save merges its frontier with the durable one, so the record a save
 * returned can name content the document has yet to load.
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
