import {
  type DocumentSummary,
  getUntitledDocumentTitle,
  type StoredDocumentKind,
} from "@tearleads/client-sdk/documents";
import { useCallback } from "react";

export type OpenInlineDocument = (
  containerId: string,
  documentKind: StoredDocumentKind,
  localId?: string,
) => void;

export function useInlineDocumentAction(params: {
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  setSelectedId: (id: string | null) => void;
}): OpenInlineDocument {
  const { expandNode, mergeDocumentSummary, setSelectedId } = params;

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
      }

      setSelectedId(nextLocalId);
      expandNode(containerId);
    },
    [expandNode, mergeDocumentSummary, setSelectedId],
  );
}
