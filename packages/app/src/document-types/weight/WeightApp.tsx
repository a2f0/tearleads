import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { Weight } from "./Weight";
import { WEIGHT_DOCUMENT_KIND } from "./weightDocumentDefinition";

export function WeightDocumentApp({
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
      initialDocumentKind={WEIGHT_DOCUMENT_KIND}
    >
      <Weight initialEditing={initialEditing} />
    </DocumentsProvider>
  );
}
