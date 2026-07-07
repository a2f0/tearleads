import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { DriverLicense } from "./DriverLicense";

export function DriverLicenseDocumentApp({
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
      initialDocumentKind="drivers_license"
    >
      <DriverLicense
        containerId={containerId ?? null}
        initialEditing={initialEditing}
        localId={localId}
      />
    </DocumentsProvider>
  );
}
