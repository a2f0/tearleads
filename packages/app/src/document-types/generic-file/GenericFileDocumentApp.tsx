import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import { FileDocument } from "../shared/FileDocument";
import type { DocumentTypeAppProps } from "../types";
import { GENERIC_FILE_DOCUMENT_KIND } from "./genericFileDocumentDefinition";

export function GenericFileDocumentApp({
  containerId,
  documentId,
  initialEditing,
  localId = DEFAULT_DOCUMENT_ID,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      initialDocumentKind={GENERIC_FILE_DOCUMENT_KIND}
    >
      <FileDocument initialEditing={initialEditing} title="File" />
    </DocumentsProvider>
  );
}
