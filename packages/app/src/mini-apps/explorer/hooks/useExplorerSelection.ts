import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContainerNode } from "../../../stores/explorer/types";

interface PendingSelectedDocument {
  containerId: string;
  id: string;
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
        ? documentSummaries.find((note) => note.id === selectedId)
        : undefined;
    const selectedMatchesNote = selectedDocument !== undefined;
    const selectedMatchesPendingDocument =
      pendingSelectedDocument?.id === selectedId;
    if (
      selectedMatchesPendingDocument &&
      selectedDocument?.containerId === pendingSelectedDocument?.containerId
    ) {
      setPendingSelectedDocument(null);
    }

    if (
      !selectedId ||
      (!selectedMatchesContainer &&
        !selectedMatchesNote &&
        !selectedMatchesPendingDocument)
    ) {
      selectItem(nodes[0]?.id ?? null);
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
        : undefined,
    [nodes, selectedId],
  );
  const selectedDocument = useMemo(
    () =>
      selectedId !== null
        ? documentSummaries.find((note) => note.id === selectedId)
        : undefined,
    [documentSummaries, selectedId],
  );
  const selectedPendingDocument =
    pendingSelectedDocument?.id === selectedId ? pendingSelectedDocument : null;

  return {
    activeContainerId:
      selectedPendingDocument?.containerId ??
      selectedDocument?.containerId ??
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
