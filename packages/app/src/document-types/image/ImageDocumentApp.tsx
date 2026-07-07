import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import { FileDocument } from "../shared/FileDocument";
import type { DocumentTypeAppProps } from "../types";
import { IMAGE_DOCUMENT_KIND } from "./imageDocumentDefinition";

export function ImageDocumentApp({
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
      initialDocumentKind={IMAGE_DOCUMENT_KIND}
    >
      <FileDocument
        initialEditing={initialEditing}
        title="Image"
        extraFieldLabels={{
          height: "Height",
          width: "Width",
        }}
      />
    </DocumentsProvider>
  );
}
