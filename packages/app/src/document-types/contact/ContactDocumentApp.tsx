import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { ContactDocument } from "./ContactDocument";

export function ContactDocumentApp({
  containerId,
  documentId,
  initialEditing,
  localId = DEFAULT_DOCUMENT_ID,
  readOnly,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      readOnly={readOnly}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      initialDocumentKind="contact"
    >
      <ContactDocument initialEditing={initialEditing} />
    </DocumentsProvider>
  );
}
