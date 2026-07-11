import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import { FileDocument } from "../shared/FileDocument";
import type { DocumentTypeAppProps } from "../types";
import { VIDEO_DOCUMENT_KIND } from "./videoDocumentDefinition";

export function VideoDocumentApp({
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
      initialDocumentKind={VIDEO_DOCUMENT_KIND}
    >
      <FileDocument
        initialEditing={initialEditing}
        title="Video"
        extraFieldLabels={{
          durationMs: "Duration",
          height: "Height",
          width: "Width",
        }}
      />
    </DocumentsProvider>
  );
}
