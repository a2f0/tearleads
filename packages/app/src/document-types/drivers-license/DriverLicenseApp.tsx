import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../data/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { DriverLicense } from "./DriverLicense";
import { createEmptyDriverLicenseDocument } from "./driverLicenseDocument";

export function DriverLicenseDocumentApp({
  containerId,
  documentId,
  localId = DEFAULT_DOCUMENT_ID,
  onPersistedDocument,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      initialText={createEmptyDriverLicenseDocument()}
      {...(onPersistedDocument === undefined ? {} : { onPersistedDocument })}
    >
      <DriverLicense />
    </DocumentsProvider>
  );
}
