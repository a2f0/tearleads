import type { DocumentSummary } from "@tearleads/client-sdk/data/documentSummary";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { useExplorerModalController } from "../modal/controller";
import type { ExplorerModalState } from "../modal/types";
import type { MoveTargetOption } from "../targetOptions";
import type {
  ExplorerDocumentMutationAction,
  ExplorerModelExplorer,
} from "./explorerModelTypes";

export interface ExplorerDocumentModalState {
  closeModal: () => void;
  draftName: string;
  draftTargetContainerId: string;
  handleModalSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSubmittingModal: boolean;
  modalError: string | null;
  modalState: ExplorerModalState | null;
  moveTargetOptions: ReadonlyArray<MoveTargetOption>;
  nameInputRef: RefObject<HTMLInputElement | null>;
  openCreateChildModal: (nodeId: string) => void;
  openDeleteModal: (nodeId: string) => void;
  openLinkDocumentModal: (documentLocalId: string) => void;
  openMoveDocumentModal: (documentLocalId: string) => void;
  openMoveModal: (nodeId: string) => void;
  openRenameModal: (nodeId: string) => void;
  openSharePeerModal: (nodeId: string) => void;
  setDraftName: Dispatch<SetStateAction<string>>;
  setDraftTargetContainerId: Dispatch<SetStateAction<string>>;
  setModalError: Dispatch<SetStateAction<string | null>>;
  targetSelectRef: RefObject<HTMLSelectElement | null>;
}

export function useExplorerDocumentModalState(params: {
  explorer: ExplorerModelExplorer;
  linkDocument: ExplorerDocumentMutationAction;
  moveDocument: ExplorerDocumentMutationAction;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  peerUserId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectionExpandNode: (nodeId: string) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}): ExplorerDocumentModalState {
  const {
    explorer,
    linkDocument,
    moveDocument,
    documentSummaries,
    peerUserId,
    setSelectedId,
    selectedDocumentLinkedContainerIds,
    selectionExpandNode,
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
    peerUserId,
    renameContainer: explorer.renameContainer,
    selectedDocumentLinkedContainerIds,
    setSelectedId,
    shareWithUser,
  });
}
