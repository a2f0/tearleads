export type {
  DocumentSummary as NoteSummary,
  DocumentsPersistence as NotesPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingAttachmentReplacementRecord,
  PendingAttachmentRewrapRecord,
  PendingUpdateInsert,
  PendingUpdateRecord,
  StoredDocumentRecord as NoteRecord,
} from "../../data/documents/documentsPersistence";
export {
  listDocumentsByContainerIds as listNotesByContainerIds,
  sqlDocumentsPersistence as sqlNotesPersistence,
  upsertDiscoveredDocuments as upsertDiscoveredNotes,
} from "../../data/documents/documentsPersistence";
