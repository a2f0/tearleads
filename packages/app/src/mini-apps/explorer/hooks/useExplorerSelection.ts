import type { ContainerNode, DocumentSummary } from "@symcrypt/client-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EXPLORER_ORPHANED_DOCUMENTS_ID,
  explorerDocumentRouteContainerId,
  isExplorerDocumentContainerSelection,
} from "../../../stores/explorer/orphanedDocuments";
import { getDocumentByLocalId } from "../model/documentSummaries";

interface PendingSelectedDocument {
  containerId: string;
  id: string;
}

function getDefaultSelectedNode(
  nodes: ReadonlyArray<ContainerNode>,
): ContainerNode | undefined {
  return nodes.find((node) => node.parentId === null) ?? nodes[0];
}

function getSelectedDocumentActiveContainerId(
  document: DocumentSummary,
  nodes: ReadonlyArray<ContainerNode>,
): string | undefined {
  if (document.containerId !== null) {
    return explorerDocumentRouteContainerId(document.containerId);
  }

  return nodes.some((node) => node.id === EXPLORER_ORPHANED_DOCUMENTS_ID)
    ? EXPLORER_ORPHANED_DOCUMENTS_ID
    : undefined;
}

function useExplorerSelectedId(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingSelectedDocument, setPendingSelectedDocument] =
    useState<PendingSelectedDocument | null>(null);

  const selectItem = useCallback((id: string | null) => {
    setPendingSelectedDocument(null);
    setSelectedId(id);
  }, []);

  const selectDocument = useCallback((id: string, containerId: string) => {
    setPendingSelectedDocument({ containerId, id });
    setSelectedId(id);
  }, []);

  useEffect(() => {
    if (nodes.length === 0) {
      selectItem(null);
      return;
    }

    const selectedMatchesContainer =
      selectedId !== null && nodes.some((node) => node.id === selectedId);
    const selectedDocument =
      selectedId !== null
        ? getDocumentByLocalId(documentSummaries, selectedId)
        : undefined;
    const selectedMatchesNote = selectedDocument !== undefined;
    const selectedMatchesPendingDocument =
      pendingSelectedDocument?.id === selectedId;
    if (
      selectedMatchesPendingDocument &&
      selectedDocument !== undefined &&
      pendingSelectedDocument !== null &&
      isExplorerDocumentContainerSelection(
        pendingSelectedDocument.containerId,
        selectedDocument.containerId,
      )
    ) {
      setPendingSelectedDocument(null);
    }

    if (
      !selectedId ||
      (!selectedMatchesContainer &&
        !selectedMatchesNote &&
        !selectedMatchesPendingDocument)
    ) {
      selectItem(getDefaultSelectedNode(nodes)?.id ?? null);
    }
  }, [
    documentSummaries,
    nodes,
    pendingSelectedDocument,
    selectItem,
    selectedId,
  ]);

  return {
    pendingSelectedDocument,
    selectDocument,
    selectedId,
    setSelectedId: selectItem,
  };
}

function useExplorerCollapsedIds(nodes: ReadonlyArray<ContainerNode>) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setCollapsedIds((currentIds) => {
      const validIds = new Set(nodes.map((node) => node.id));
      let changed = false;
      const nextIds = new Set<string>();

      for (const id of currentIds) {
        if (validIds.has(id)) {
          nextIds.add(id);
        } else {
          changed = true;
        }
      }

      return changed ? nextIds : currentIds;
    });
  }, [nodes]);

  const toggleCollapsed = useCallback((nodeId: string) => {
    setCollapsedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(nodeId)) {
        nextIds.delete(nodeId);
      } else {
        nextIds.add(nodeId);
      }
      return nextIds;
    });
  }, []);

  const expandNode = useCallback((nodeId: string) => {
    setCollapsedIds((currentIds) => {
      if (!currentIds.has(nodeId)) {
        return currentIds;
      }

      const nextIds = new Set(currentIds);
      nextIds.delete(nodeId);
      return nextIds;
    });
  }, []);

  return { collapsedIds, expandNode, toggleCollapsed };
}

export function useExplorerSelection(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
) {
  const { pendingSelectedDocument, selectDocument, selectedId, setSelectedId } =
    useExplorerSelectedId(nodes, documentSummaries);
  const { collapsedIds, expandNode, toggleCollapsed } =
    useExplorerCollapsedIds(nodes);
  const selectedNode = useMemo(
    () =>
      selectedId !== null
        ? nodes.find((node) => node.id === selectedId)
        : getDefaultSelectedNode(nodes),
    [nodes, selectedId],
  );
  const selectedDocument = useMemo(
    () =>
      selectedId !== null
        ? getDocumentByLocalId(documentSummaries, selectedId)
        : undefined,
    [documentSummaries, selectedId],
  );
  const selectedPendingDocument =
    pendingSelectedDocument?.id === selectedId ? pendingSelectedDocument : null;

  return {
    activeContainerId:
      selectedPendingDocument?.containerId ??
      (selectedDocument
        ? getSelectedDocumentActiveContainerId(selectedDocument, nodes)
        : undefined) ??
      selectedNode?.id ??
      null,
    collapsedIds,
    expandNode,
    selectedId,
    selectedNode,
    selectedDocument,
    selectDocument,
    setSelectedId,
    toggleCollapsed,
  };
}

export type ExplorerSelectionState = ReturnType<typeof useExplorerSelection>;
