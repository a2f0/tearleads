import { Notes } from "../../mini-apps/notes/Notes";
import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";

export function NoteDocumentApp({
  containerId,
  documentId,
  localId = DEFAULT_DOCUMENT_ID,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
    >
      <Notes />
    </DocumentsProvider>
  );
}
