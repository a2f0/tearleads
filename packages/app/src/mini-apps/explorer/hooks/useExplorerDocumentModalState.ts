import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type { DocumentSummary } from "../../../data/documentSummary";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../containerInfo";
import {
  type ExplorerModalState,
  useExplorerModalController,
} from "../modal/ExplorerModal";
import type { MoveTargetOption } from "../targetOptions";
import type {
  ExplorerDocumentMutationAction,
  ExplorerModelExplorer,
} from "./explorerModelTypes";

export interface ExplorerDocumentModalState {
  closeModal: () => void;
  containerInfo: ExplorerContainerInfo | null;
  containerInfoError: string | null;
  draftName: string;
  draftShareAccessLevel: ExplorerContainerShareAccessLevel;
  draftShareGroupId: string;
  draftTargetContainerId: string;
  handleContainerInfoPeerShare: () => void;
  handleModalSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isLoadingContainerInfo: boolean;
  isSubmittingModal: boolean;
  modalError: string | null;
  modalState: ExplorerModalState | null;
  moveTargetOptions: ReadonlyArray<MoveTargetOption>;
  nameInputRef: RefObject<HTMLInputElement | null>;
  openCreateChildModal: (nodeId: string) => void;
  openContainerInfoModal: (nodeId: string) => void;
  openDeleteModal: (nodeId: string) => void;
  openLinkDocumentModal: (documentLocalId: string) => void;
  openMoveDocumentModal: (documentLocalId: string) => void;
  openMoveModal: (nodeId: string) => void;
  openRenameModal: (nodeId: string) => void;
  openSharePeerModal: (nodeId: string) => void;
  setDraftName: Dispatch<SetStateAction<string>>;
  setDraftShareAccessLevel: Dispatch<
    SetStateAction<ExplorerContainerShareAccessLevel>
  >;
  setDraftShareGroupId: Dispatch<SetStateAction<string>>;
  setDraftTargetContainerId: Dispatch<SetStateAction<string>>;
  setModalError: Dispatch<SetStateAction<string | null>>;
  targetSelectRef: RefObject<HTMLSelectElement | null>;
}

export function useExplorerDocumentModalState(params: {
  explorer: ExplorerModelExplorer;
  linkDocument: ExplorerDocumentMutationAction;
  moveDocument: ExplorerDocumentMutationAction;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadContainerInfo: (containerId: string) => Promise<ExplorerContainerInfo>;
  peerUserId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectionExpandNode: (nodeId: string) => void;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ExplorerContainerShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}): ExplorerDocumentModalState {
  const {
    explorer,
    linkDocument,
    moveDocument,
    documentSummaries,
    loadContainerInfo,
    peerUserId,
    setSelectedId,
    selectedDocumentLinkedContainerIds,
    selectionExpandNode,
    shareWithGroup,
    shareWithUser,
  } = params;

  return useExplorerModalController({
    createChild: explorer.createChild,
    deleteContainer: explorer.deleteContainer,
    expandNode: selectionExpandNode,
    linkDocument,
    moveContainer: explorer.moveContainer,
    moveDocument,
    nodes: explorer.nodes,
    documentSummaries,
    loadContainerInfo,
    peerUserId,
    renameContainer: explorer.renameContainer,
    selectedDocumentLinkedContainerIds,
    setSelectedId,
    shareWithGroup,
    shareWithUser,
  });
}
