import type { StoredDocumentKind } from "@tearleads/client-sdk";
import type { ComponentType } from "react";
import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { FileDocument } from "./FileDocument";

interface DocumentTypeContentProps {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}

export function createDocumentTypeApp(
  initialDocumentKind: StoredDocumentKind | undefined,
  Document: ComponentType<DocumentTypeContentProps>,
): ComponentType<DocumentTypeAppProps> {
  function DocumentTypeApp({
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
        {...(initialDocumentKind === undefined ? {} : { initialDocumentKind })}
      >
        <Document
          containerId={containerId ?? null}
          initialEditing={initialEditing}
          localId={localId}
        />
      </DocumentsProvider>
    );
  }

  DocumentTypeApp.displayName = `${Document.displayName ?? Document.name}App`;
  return DocumentTypeApp;
}

export function createFileDocumentTypeApp(
  initialDocumentKind: StoredDocumentKind,
  config: {
    extraFieldLabels?: Readonly<Record<string, string>> | undefined;
    title: string;
  },
): ComponentType<DocumentTypeAppProps> {
  function FileDocumentType({ initialEditing }: DocumentTypeContentProps) {
    return <FileDocument {...config} initialEditing={initialEditing} />;
  }

  const App = createDocumentTypeApp(initialDocumentKind, FileDocumentType);
  const kindName = initialDocumentKind
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("");
  App.displayName = `${kindName}DocumentApp`;
  return App;
}
