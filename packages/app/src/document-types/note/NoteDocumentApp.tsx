import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../data/documents/DocumentsProvider";
import { Notes } from "../../mini-apps/notes/Notes";
import type { DocumentTypeAppProps } from "../types";

export function NoteDocumentApp({
  containerId,
  documentId,
  localId = DEFAULT_DOCUMENT_ID,
  onPersistedDocument,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      {...(onPersistedDocument === undefined ? {} : { onPersistedDocument })}
    >
      <Notes />
    </DocumentsProvider>
  );
}
