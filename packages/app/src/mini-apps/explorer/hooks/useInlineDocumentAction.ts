import { useCallback } from "react";
import {
  getUntitledDocumentTitle,
  type StoredDocumentKind,
} from "../../../data/documents/documentKinds";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";

type OpenInlineDocument = (
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
        mergeDocumentSummary({
          id: nextLocalId,
          containerId,
          documentKind,
          documentId: null,
          title: getUntitledDocumentTitle(documentKind),
          updatedAt: new Date().toISOString(),
        });
      }

      setSelectedId(nextLocalId);
      expandNode(containerId);
    },
    [expandNode, mergeDocumentSummary, setSelectedId],
  );
}
