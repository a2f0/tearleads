import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import { FileDocument } from "../shared/FileDocument";
import type { DocumentTypeAppProps } from "../types";
import { PDF_DOCUMENT_KIND } from "./pdfDocumentDefinition";

export function PdfDocumentApp({
  containerId,
  documentId,
  localId = DEFAULT_DOCUMENT_ID,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      initialDocumentKind={PDF_DOCUMENT_KIND}
    >
      <FileDocument title="PDF" extraFieldLabels={{ pageCount: "Pages" }} />
    </DocumentsProvider>
  );
}
