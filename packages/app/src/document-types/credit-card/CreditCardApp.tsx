import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../data/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { CreditCard } from "./CreditCard";
import { createEmptyCreditCardDocument } from "./creditCardDocument";

export function CreditCardDocumentApp({
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
      initialText={createEmptyCreditCardDocument()}
      {...(onPersistedDocument === undefined ? {} : { onPersistedDocument })}
    >
      <CreditCard />
    </DocumentsProvider>
  );
}
