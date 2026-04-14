import type { DocumentSummary } from "../data/documents/documentsPersistence";

export interface DocumentTypeAppProps {
  containerId?: string | null;
  documentId?: string | null;
  localId?: string;
  onPersistedDocument?: (document: DocumentSummary) => void;
}
