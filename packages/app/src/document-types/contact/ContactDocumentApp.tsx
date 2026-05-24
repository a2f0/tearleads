import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { ContactDocument } from "./ContactDocument";

export function ContactDocumentApp({
  containerId,
  documentId,
  localId = DEFAULT_DOCUMENT_ID,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      initialDocumentKind="contact"
    >
      <ContactDocument />
    </DocumentsProvider>
  );
}
