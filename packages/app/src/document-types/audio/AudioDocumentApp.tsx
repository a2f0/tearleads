import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import { FileDocument } from "../shared/FileDocument";
import type { DocumentTypeAppProps } from "../types";
import { AUDIO_DOCUMENT_KIND } from "./audioDocumentDefinition";

export function AudioDocumentApp({
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
      initialDocumentKind={AUDIO_DOCUMENT_KIND}
    >
      <FileDocument
        initialEditing={initialEditing}
        title="Audio"
        extraFieldLabels={{ durationMs: "Duration" }}
      />
    </DocumentsProvider>
  );
}
