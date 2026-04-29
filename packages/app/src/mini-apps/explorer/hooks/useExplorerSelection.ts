import { useCallback, useEffect, useState } from "react";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";
import type { ContainerNode } from "../types";

export function useExplorerSelection(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (nodes.length === 0) {
      setSelectedId(null);
      return;
    }

    const selectedMatchesContainer = nodes.some(
      (node) => node.id === selectedId,
    );
    const selectedMatchesNote = documentSummaries.some(
      (note) => note.id === selectedId,
    );

    if (!selectedId || (!selectedMatchesContainer && !selectedMatchesNote)) {
      setSelectedId(nodes[0]?.id ?? null);
    }
  }, [nodes, documentSummaries, selectedId]);

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

  const selectedNode = nodes.find((node) => node.id === selectedId);
  const selectedDocument = documentSummaries.find(
    (note) => note.id === selectedId,
  );

  return {
    activeContainerId:
      selectedDocument?.containerId ?? selectedNode?.id ?? null,
    collapsedIds,
    expandNode,
    selectedId,
    selectedNode,
    selectedDocument,
    setSelectedId,
    toggleCollapsed,
  };
}

export type ExplorerSelectionState = ReturnType<typeof useExplorerSelection>;
