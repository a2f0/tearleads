import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EXPLORER_ORPHANED_DOCUMENTS_ID,
  explorerDocumentRouteContainerId,
  isExplorerDocumentContainerSelection,
} from "../../../stores/explorer/orphanedDocuments";
import { getDocumentByLocalId } from "../model/documentSummaries";

interface LastSelectedContainer {
  /** Not yet on the server, as a recovered device's bootstrap copy is. */
  readonly deviceLocal: boolean;
  readonly id: string;
  readonly systemSlot: string | null;
}

/**
 * Recovery may first move the device's local copy under the remote root, which
 * gives it the remote organization, before the identity's own copy replaces
 * it; so a container seen device-local stays device-local for its id.
 */
function lastSelectedContainer(
  node: ContainerNode,
  previous: LastSelectedContainer | null,
): LastSelectedContainer {
  return {
    deviceLocal:
      node.organizationId === "" ||
      node.syncState.status === "local-only" ||
      (previous?.id === node.id && previous.deviceLocal),
    id: node.id,
    systemSlot: node.systemSlot ?? null,
  };
}

interface PendingSelectedDocument {
  containerId: string;
  id: string;
}

function getDefaultSelectedNode(
  nodes: ReadonlyArray<ContainerNode>,
): ContainerNode | undefined {
  return nodes.find((node) => node.parentId === null) ?? nodes[0];
}

/**
 * The slot of a vanished device-local system container selection. A recovered
 * device replaces its locally created Contacts or Trash, which is not yet on
 * the server, with the identity's existing one under a new id (#2393); the
 * selection follows it rather than falling back to the root. Switching
 * organizations still resets to the root.
 */
function getVanishedLocalSystemSlot(
  selectedId: string | null,
  vanished: LastSelectedContainer | null,
): string | null {
  return vanished?.systemSlot &&
    vanished.deviceLocal &&
    vanished.id === selectedId
    ? vanished.systemSlot
    : null;
}

/**
 * The replacement when exactly one node has the slot. The tree can reload
 * through an empty or root-only state before the replacement arrives, so a
 * missing slot keeps waiting, while an ambiguous one stops following.
 */
function findSystemSlotReplacement(
  nodes: ReadonlyArray<ContainerNode>,
  systemSlot: string,
): ContainerNode | "ambiguous" | undefined {
  const candidates = nodes.filter((node) => node.systemSlot === systemSlot);
  return candidates.length > 1 ? "ambiguous" : candidates[0];
}

interface ContainerSelectionResolution {
  /** The slot still awaiting its replacement after this pass. */
  readonly followedSlot: string | null;
  /** The id to select, or undefined to keep the current selection. */
  readonly selectId?: string | null;
}

/** Follow a vanished selection's slot, or fall back to the root. */
function resolveContainerSelection(input: {
  readonly followedSlot: string | null;
  readonly nodes: ReadonlyArray<ContainerNode>;
  readonly selectedId: string | null;
  readonly selectionMissing: boolean;
  readonly vanished: LastSelectedContainer | null;
}): ContainerSelectionResolution {
  const slot =
    input.followedSlot ??
    (input.selectionMissing
      ? getVanishedLocalSystemSlot(input.selectedId, input.vanished)
      : null);
  const replacement =
    slot === null ? undefined : findSystemSlotReplacement(input.nodes, slot);
  if (replacement !== undefined && replacement !== "ambiguous") {
    return replacement.id === input.selectedId
      ? { followedSlot: null }
      : { followedSlot: null, selectId: replacement.id };
  }
  const followedSlot = replacement === "ambiguous" ? null : slot;
  return input.selectionMissing
    ? {
        followedSlot,
        selectId: getDefaultSelectedNode(input.nodes)?.id ?? null,
      }
    : { followedSlot };
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
  const selectedContainer = useRef<LastSelectedContainer | null>(null);
  // A vanished selection's slot that is still awaiting its replacement. Any
  // explicit selection abandons it.
  const followedSystemSlot = useRef<string | null>(null);

  const selectItem = useCallback((id: string | null) => {
    setPendingSelectedDocument(null);
    setSelectedId(id);
  }, []);

  const chooseItem = useCallback(
    (id: string | null) => {
      followedSystemSlot.current = null;
      selectItem(id);
    },
    [selectItem],
  );

  const selectDocument = useCallback((id: string, containerId: string) => {
    followedSystemSlot.current = null;
    setPendingSelectedDocument({ containerId, id });
    setSelectedId(id);
  }, []);

  useEffect(() => {
    if (nodes.length === 0) {
      followedSystemSlot.current ??= getVanishedLocalSystemSlot(
        selectedId,
        selectedContainer.current,
      );
      selectItem(null);
      return;
    }

    const selectedNode = nodes.find((node) => node.id === selectedId);
    const selectedMatchesContainer = selectedNode !== undefined;
    if (selectedNode) {
      selectedContainer.current = lastSelectedContainer(
        selectedNode,
        selectedContainer.current,
      );
    }
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

    const resolution = resolveContainerSelection({
      followedSlot: followedSystemSlot.current,
      nodes,
      selectedId,
      selectionMissing:
        !selectedId ||
        (!selectedMatchesContainer &&
          !selectedMatchesNote &&
          !selectedMatchesPendingDocument),
      vanished: selectedContainer.current,
    });
    followedSystemSlot.current = resolution.followedSlot;
    if (resolution.selectId !== undefined) selectItem(resolution.selectId);
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
    setSelectedId: chooseItem,
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
