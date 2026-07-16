import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { BloodPressure } from "./BloodPressure";
import { BLOOD_PRESSURE_DOCUMENT_KIND } from "./bloodPressureDocumentDefinition";

export function BloodPressureDocumentApp({
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
      initialDocumentKind={BLOOD_PRESSURE_DOCUMENT_KIND}
    >
      <BloodPressure initialEditing={initialEditing} />
    </DocumentsProvider>
  );
}
