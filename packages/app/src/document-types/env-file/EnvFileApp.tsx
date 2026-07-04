import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { EnvFile } from "./EnvFile";
import { ENV_FILE_DOCUMENT_KIND } from "./envFileDocumentDefinition";

export function EnvFileDocumentApp({
  containerId,
  documentId,
  localId = DEFAULT_DOCUMENT_ID,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      initialDocumentKind={ENV_FILE_DOCUMENT_KIND}
    >
      <EnvFile />
    </DocumentsProvider>
  );
}
