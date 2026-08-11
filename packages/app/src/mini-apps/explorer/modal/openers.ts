import type { ContainerNode } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  canCreateChildContainerByRules,
  canRenameContainerByRules,
  canWriteContainerNode,
  type ExplorerContainerRulesContext,
} from "../model/containerRules";
import {
  type ExplorerTargetLookups,
  getDocumentLinkedContainerIds,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
  getMoveTargetOptions,
  type MoveTargetOption,
} from "../model/targetOptions";
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

// Shared by every opener; each builder destructures the subset it needs.
interface ExplorerModalOpenersParams {
  canShareWithPeer: boolean;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
  targetLookups: ExplorerTargetLookups;
}

interface ExplorerOpenedModal {
  draftName?: string;
  draftTargetContainerId?: string;
  nextModalState: ExplorerModalState;
}

type ExplorerModalBuilder = (
  params: ExplorerModalOpenersParams,
  targetId: string,
) => ExplorerOpenedModal | null;

// One opener body for every modal: the builder resolves the rule/target gates
// and returns null when the modal must not open.
function useExplorerModalOpener(
  params: ExplorerModalOpenersParams,
  buildModal: ExplorerModalBuilder,
) {
  return useCallback(
    (targetId: string) => {
      const modal = buildModal(params, targetId);
      if (!modal) {
        return;
      }

      params.setModalState(modal.nextModalState);
      params.setModalError(null);
      params.setDraftName(modal.draftName ?? "");
      params.setDraftTargetContainerId(modal.draftTargetContainerId ?? "");
    },
    [buildModal, params],
  );
}

// A target-choosing modal opens only when at least one destination exists, with
// the first (alphabetically sorted) target preselected.
function openedTargetModal(
  nextModalState: ExplorerModalState,
  targetOptions: ReadonlyArray<MoveTargetOption>,
): ExplorerOpenedModal | null {
  return targetOptions.length === 0
    ? null
    : {
        draftTargetContainerId: targetOptions[0]?.id ?? "",
        nextModalState,
      };
}

const buildExplorerMoveModal: ExplorerModalBuilder = (params, containerId) =>
  openedTargetModal(
    { mode: "move", nodeId: containerId },
    getMoveTargetOptions(
      params.nodes,
      containerId,
      params.targetLookups,
      params.rulesContext,
    ),
  );

const buildExplorerMoveDocumentModal: ExplorerModalBuilder = (
  params,
  documentLocalId,
) =>
  openedTargetModal(
    { documentLocalId, mode: "move-document" },
    getDocumentMoveTargetOptions(
      params.nodes,
      documentLocalId,
      params.targetLookups,
      params.rulesContext,
      params.linkedContainerIdsByDocumentId,
    ),
  );

const buildExplorerLinkDocumentModal: ExplorerModalBuilder = (
  params,
  documentLocalId,
) =>
  openedTargetModal(
    { documentLocalId, mode: "link-document" },
    getDocumentLinkTargetOptions(
      params.nodes,
      documentLocalId,
      getDocumentLinkedContainerIds({
        document:
          params.targetLookups.documentSummariesById.get(documentLocalId),
        linkedContainerIdsByDocumentId: params.linkedContainerIdsByDocumentId,
      }),
      params.targetLookups,
      params.rulesContext,
    ),
  );

const buildExplorerCreateChildModal: ExplorerModalBuilder = (
  params,
  parentId,
) =>
  canCreateChildContainerByRules(
    params.rulesContext,
    params.targetLookups.nodesById.get(parentId),
  )
    ? { nextModalState: { mode: "create-child", nodeId: parentId } }
    : null;

const buildExplorerRenameModal: ExplorerModalBuilder = (
  params,
  containerId,
) => {
  const container = params.targetLookups.nodesById.get(containerId);
  return container && canRenameContainerByRules(params.rulesContext, container)
    ? {
        draftName: container.name,
        nextModalState: { mode: "rename", nodeId: containerId },
      }
    : null;
};

// "Delete Forever", "Empty Trash", and peer sharing share the
// writable-container gate and differ only in the modal they open.
function openedWritableContainerModal(
  params: ExplorerModalOpenersParams,
  nextModalState: ExplorerModalState & { nodeId: string },
): ExplorerOpenedModal | null {
  return canWriteContainerNode(
    params.targetLookups.nodesById.get(nextModalState.nodeId),
  )
    ? { nextModalState }
    : null;
}

const buildExplorerPurgeModal: ExplorerModalBuilder = (params, containerId) =>
  openedWritableContainerModal(params, { mode: "purge", nodeId: containerId });

const buildExplorerEmptyTrashModal: ExplorerModalBuilder = (
  params,
  containerId,
) =>
  openedWritableContainerModal(params, {
    mode: "empty-trash",
    nodeId: containerId,
  });

const buildExplorerSharePeerModal: ExplorerModalBuilder = (
  params,
  containerId,
) =>
  params.canShareWithPeer
    ? openedWritableContainerModal(params, {
        mode: "share-peer",
        nodeId: containerId,
      })
    : null;

export function useExplorerModalOpeners(params: ExplorerModalOpenersParams) {
  return {
    openCreateChildModal: useExplorerModalOpener(
      params,
      buildExplorerCreateChildModal,
    ),
    openEmptyTrashModal: useExplorerModalOpener(
      params,
      buildExplorerEmptyTrashModal,
    ),
    openLinkDocumentModal: useExplorerModalOpener(
      params,
      buildExplorerLinkDocumentModal,
    ),
    openMoveDocumentModal: useExplorerModalOpener(
      params,
      buildExplorerMoveDocumentModal,
    ),
    openMoveModal: useExplorerModalOpener(params, buildExplorerMoveModal),
    openPurgeModal: useExplorerModalOpener(params, buildExplorerPurgeModal),
    openRenameModal: useExplorerModalOpener(params, buildExplorerRenameModal),
    openSharePeerModal: useExplorerModalOpener(
      params,
      buildExplorerSharePeerModal,
    ),
  };
}
