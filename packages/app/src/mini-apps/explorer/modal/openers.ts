import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  canCreateChildContainerByRules,
  canRenameContainerByRules,
  canWriteContainerNode,
  type ExplorerContainerRulesContext,
} from "../containerRules";
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

function openExplorerSimpleModal(params: {
  draftName?: string;
  nextModalState: ExplorerModalState;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
}) {
  params.setModalState(params.nextModalState);
  params.setModalError(null);
  params.setDraftName(params.draftName ?? "");
  params.setDraftTargetContainerId("");
}

interface ExplorerModalOpenersParams {
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
          linkedContainerIdsByDocumentId,
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

interface ExplorerContainerModalOpenerParams {
  rulesContext: ExplorerContainerRulesContext;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}

function useExplorerCreateChildModalOpener(
  params: ExplorerContainerModalOpenerParams,
) {
  const {
    rulesContext,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;

  return useCallback(
    (parentId: string) => {
      if (
        !canCreateChildContainerByRules(
          rulesContext,
          targetLookups.nodesById.get(parentId),
        )
      ) {
        return;
      }

      openExplorerSimpleModal({
        nextModalState: { mode: "create-child", nodeId: parentId },
        setDraftName,
        setDraftTargetContainerId,
        setModalError,
        setModalState,
      });
    },
    [
      rulesContext,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
    ],
  );
}

function useExplorerRenameModalOpener(
  params: ExplorerContainerModalOpenerParams,
) {
  const {
    rulesContext,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;

  return useCallback(
    (containerId: string) => {
      const container = targetLookups.nodesById.get(containerId);
      if (!container || !canRenameContainerByRules(rulesContext, container)) {
        return;
      }

      openExplorerSimpleModal({
        draftName: container.name,
        nextModalState: { mode: "rename", nodeId: containerId },
        setDraftName,
        setDraftTargetContainerId,
        setModalError,
        setModalState,
      });
    },
    [
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
      rulesContext,
    ],
  );
}

function useExplorerPurgeModalOpener(
  params: ExplorerContainerModalOpenerParams,
) {
  const {
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;

  return useCallback(
    (containerId: string) => {
      if (!canWriteContainerNode(targetLookups.nodesById.get(containerId))) {
        return;
      }

      openExplorerSimpleModal({
        nextModalState: { mode: "purge", nodeId: containerId },
        setDraftName,
        setDraftTargetContainerId,
        setModalError,
        setModalState,
      });
    },
    [
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
    ],
  );
}

function useExplorerEmptyTrashModalOpener(
  params: ExplorerContainerModalOpenerParams,
) {
  const {
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;

  return useCallback(
    (containerId: string) => {
      if (!canWriteContainerNode(targetLookups.nodesById.get(containerId))) {
        return;
      }

      openExplorerSimpleModal({
        nextModalState: { mode: "empty-trash", nodeId: containerId },
        setDraftName,
        setDraftTargetContainerId,
        setModalError,
        setModalState,
      });
    },
    [
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
    ],
  );
}

function useExplorerSharePeerModalOpener(
  params: ExplorerContainerModalOpenerParams & { canShareWithPeer: boolean },
) {
  const {
    canShareWithPeer,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
    targetLookups,
  } = params;

  return useCallback(
    (containerId: string) => {
      if (
        !canShareWithPeer ||
        !canWriteContainerNode(targetLookups.nodesById.get(containerId))
      ) {
        return;
      }

      openExplorerSimpleModal({
        nextModalState: { mode: "share-peer", nodeId: containerId },
        setDraftName,
        setDraftTargetContainerId,
        setModalError,
        setModalState,
      });
    },
    [
      canShareWithPeer,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
      targetLookups,
    ],
  );
}

export function useExplorerModalOpeners(params: ExplorerModalOpenersParams) {
  const targetOpeners = useExplorerTargetModalOpeners(params);
  const openCreateChildModal = useExplorerCreateChildModalOpener(params);
  const openEmptyTrashModal = useExplorerEmptyTrashModalOpener(params);
  const openRenameModal = useExplorerRenameModalOpener(params);
  const openPurgeModal = useExplorerPurgeModalOpener(params);
  const openSharePeerModal = useExplorerSharePeerModalOpener(params);

  return {
    ...targetOpeners,
    openCreateChildModal,
    openEmptyTrashModal,
    openPurgeModal,
    openRenameModal,
    openSharePeerModal,
  };
}
