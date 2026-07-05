import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { JsonFileDocument } from "./JsonFileDocument";
import { JSON_FILE_DOCUMENT_KIND } from "./jsonFileDocumentDefinition";

export function JsonFileDocumentApp({
  containerId,
  documentId,
  localId = DEFAULT_DOCUMENT_ID,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      initialDocumentKind={JSON_FILE_DOCUMENT_KIND}
    >
      <JsonFileDocument />
    </DocumentsProvider>
  );
}
