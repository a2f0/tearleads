import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../data/documents/DocumentsProvider";
import type { DocumentSummary } from "../../data/documents/documentsPersistence";
import { DriverLicense } from "./DriverLicense";
import { createEmptyDriverLicenseDocument } from "./driverLicenseDocument";

interface DriverLicenseAppProps {
  containerId?: string | null;
  documentId?: string | null;
  noteId?: string;
  onPersistedNote?: (note: DocumentSummary) => void;
}

export function DriverLicenseApp({
  containerId,
  documentId,
  noteId = DEFAULT_DOCUMENT_ID,
  onPersistedNote,
}: DriverLicenseAppProps) {
  return (
    <DocumentsProvider
      localId={noteId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      initialText={createEmptyDriverLicenseDocument()}
      {...(onPersistedNote === undefined
        ? {}
        : { onPersistedDocument: onPersistedNote })}
    >
      <DriverLicense />
    </DocumentsProvider>
  );
}
