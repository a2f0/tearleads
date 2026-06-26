import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { useCallback } from "react";
import type { ExplorerContainerRulesContext } from "../containerRules";
import {
  type ExplorerTargetLookups,
  getDocumentLinkedContainerIds,
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
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
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
  rulesContext: ExplorerContainerRulesContext;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}) {
  const {
    nodes,
    rulesContext,
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
        targetOptions: getMoveTargetOptions(
          nodes,
          containerId,
          targetLookups,
          rulesContext,
        ),
      });
    },
    [
      nodes,
      rulesContext,
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
  rulesContext: ExplorerContainerRulesContext;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}) {
  const {
    documentSummaries,
    nodes,
    rulesContext,
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
          rulesContext,
        ),
      });
    },
    [
      documentSummaries,
      nodes,
      rulesContext,
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
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}) {
  const {
    documentSummaries,
    linkedContainerIdsByDocumentId,
    nodes,
    rulesContext,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;

  return useCallback(
    (documentLocalId: string) => {
      const linkingDocument =
        targetLookups.documentSummariesById.get(documentLocalId);
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
          getDocumentLinkedContainerIds({
            document: linkingDocument,
            linkedContainerIdsByDocumentId,
          }),
          targetLookups,
          rulesContext,
        ),
      });
    },
    [
      documentSummaries,
      linkedContainerIdsByDocumentId,
      nodes,
      rulesContext,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
    ],
  );
}

export function useExplorerModalOpeners(params: {
  canShareWithPeer: boolean;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}) {
  const {
    canShareWithPeer,
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

  const openPurgeModal = useCallback(
    (containerId: string) => {
      setModalState({ mode: "purge", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  const openSharePeerModal = useCallback(
    (containerId: string) => {
      if (!canShareWithPeer) {
        return;
      }

      setModalState({ mode: "share-peer", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [
      canShareWithPeer,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  return {
    ...targetOpeners,
    openCreateChildModal,
    openDeleteModal,
    openPurgeModal,
    openRenameModal,
    openSharePeerModal,
  };
}
