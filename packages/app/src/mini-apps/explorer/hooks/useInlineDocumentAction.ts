import {
  type DocumentSummary,
  getUntitledDocumentTitle,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useCallback } from "react";

export type OpenInlineDocument = (
  containerId: string,
  documentKind: StoredDocumentKind,
  localId?: string,
) => void;

export function useInlineDocumentAction(params: {
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  onCreateDocument?: (
    localId: string,
    documentKind: StoredDocumentKind,
  ) => void;
  setSelectedId: (id: string) => void;
}): OpenInlineDocument {
  const { expandNode, mergeDocumentSummary, onCreateDocument, setSelectedId } =
    params;

  return useCallback(
    (
      containerId: string,
      documentKind: StoredDocumentKind,
      localId?: string,
    ) => {
      const nextLocalId = localId ?? crypto.randomUUID();

      if (!localId) {
        const createdAt = new Date().toISOString();
        mergeDocumentSummary({
          createdAt,
          id: nextLocalId,
          containerId,
          documentKind,
          documentId: null,
          title: getUntitledDocumentTitle(documentKind),
          updatedAt: createdAt,
        });
        onCreateDocument?.(nextLocalId, documentKind);
      }

      setSelectedId(nextLocalId);
      expandNode(containerId);
    },
    [expandNode, mergeDocumentSummary, onCreateDocument, setSelectedId],
  );
}
