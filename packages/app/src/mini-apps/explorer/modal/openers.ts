import type { ContainerNode } from "@tearleads/client-sdk";
import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { useCallback } from "react";
import {
  type ExplorerTargetLookups,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
  getMoveTargetOptions,
  type MoveTargetOption,
} from "../targetOptions";
import type { ExplorerModalState } from "./types";

export function clearExplorerModalState(
  setModalState: (state: ExplorerModalState | null) => void,
  setModalError: (error: string | null) => void,
  setDraftName: (value: string) => void,
  setDraftTargetContainerId: (value: string) => void,
) {
  setModalState(null);
  setModalError(null);
  setDraftName("");
  setDraftTargetContainerId("");
}

function openExplorerTargetModal(params: {
  nextModalState:
    | { mode: "link-document"; documentLocalId: string }
    | { mode: "move"; nodeId: string }
    | { mode: "move-document"; documentLocalId: string };
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetOptions: ReadonlyArray<MoveTargetOption>;
}) {
  const {
    nextModalState,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetOptions,
  } = params;
  if (targetOptions.length === 0) {
    return;
  }

  setModalState(nextModalState);
  setModalError(null);
  setDraftName("");
  setDraftTargetContainerId(targetOptions[0]?.id ?? "");
}

function useExplorerTargetModalOpeners(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}) {
  const openMoveModal = useExplorerMoveModalOpener(params);
  const openMoveDocumentModal = useExplorerMoveDocumentModalOpener(params);
  const openLinkDocumentModal = useExplorerLinkDocumentModalOpener(params);

  return {
    openLinkDocumentModal,
    openMoveDocumentModal,
    openMoveModal,
  };
}

function useExplorerMoveModalOpener(params: {
  nodes: ReadonlyArray<ContainerNode>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}) {
  const {
    nodes,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;

  return useCallback(
    (containerId: string) => {
      openExplorerTargetModal({
        nextModalState: { mode: "move", nodeId: containerId },
        setDraftName,
        setDraftTargetContainerId,
        setModalError,
        setModalState,
        targetOptions: getMoveTargetOptions(nodes, containerId, targetLookups),
      });
    },
    [
      nodes,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
    ],
  );
}

function useExplorerMoveDocumentModalOpener(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  nodes: ReadonlyArray<ContainerNode>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}) {
  const {
    documentSummaries,
    nodes,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;

  return useCallback(
    (documentLocalId: string) => {
      openExplorerTargetModal({
        nextModalState: { mode: "move-document", documentLocalId },
        setDraftName,
        setDraftTargetContainerId,
        setModalError,
        setModalState,
        targetOptions: getDocumentMoveTargetOptions(
          nodes,
          documentSummaries,
          documentLocalId,
          targetLookups,
        ),
      });
    },
    [
      documentSummaries,
      nodes,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
    ],
  );
}

function useExplorerLinkDocumentModalOpener(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}) {
  const {
    documentSummaries,
    nodes,
    selectedDocumentLinkedContainerIds,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;

  return useCallback(
    (documentLocalId: string) => {
      openExplorerTargetModal({
        nextModalState: { mode: "link-document", documentLocalId },
        setDraftName,
        setDraftTargetContainerId,
        setModalError,
        setModalState,
        targetOptions: getDocumentLinkTargetOptions(
          nodes,
          documentSummaries,
          documentLocalId,
          selectedDocumentLinkedContainerIds,
          targetLookups,
        ),
      });
    },
    [
      documentSummaries,
      nodes,
      selectedDocumentLinkedContainerIds,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
    ],
  );
}

export function useExplorerModalOpeners(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}) {
  const {
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;
  const targetOpeners = useExplorerTargetModalOpeners(params);

  const openCreateChildModal = useCallback(
    (parentId: string) => {
      setModalState({ mode: "create-child", nodeId: parentId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  const openRenameModal = useCallback(
    (containerId: string) => {
      const container = targetLookups.nodesById.get(containerId);
      if (!container) {
        return;
      }

      setModalState({ mode: "rename", nodeId: containerId });
      setModalError(null);
      setDraftName(container.name);
      setDraftTargetContainerId("");
    },
    [
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
    ],
  );

  const openDeleteModal = useCallback(
    (containerId: string) => {
      setModalState({ mode: "delete", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  const openSharePeerModal = useCallback(
    (containerId: string) => {
      setModalState({ mode: "share-peer", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  return {
    ...targetOpeners,
    openCreateChildModal,
    openDeleteModal,
    openRenameModal,
    openSharePeerModal,
  };
}
