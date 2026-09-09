import type {
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { createDocumentDraft } from "../../../stores/documents/documentDraft";

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
      let nextLocalId = localId;
      if (!nextLocalId) {
        const draft = createDocumentDraft({ containerId, documentKind });
        nextLocalId = draft.id;
        mergeDocumentSummary(draft);
        onCreateDocument?.(draft.id, documentKind);
      }

      setSelectedId(nextLocalId);
      expandNode(containerId);
    },
    [expandNode, mergeDocumentSummary, onCreateDocument, setSelectedId],
  );
}
