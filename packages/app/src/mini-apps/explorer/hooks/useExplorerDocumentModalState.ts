import type { DocumentSummary } from "@tearleads/client-sdk";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type { ExplorerContainerRulesContext } from "../containerRules";
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
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  peerUserId: string | null;
  rulesContext: ExplorerContainerRulesContext;
  setSelectedId: (id: string | null) => void;
  selectionExpandNode: (nodeId: string) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}): ExplorerDocumentModalState {
  const {
    explorer,
    linkDocument,
    moveDocument,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    peerUserId,
    rulesContext,
    setSelectedId,
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
    linkedContainerIdsByDocumentId,
    peerUserId,
    renameContainer: explorer.renameContainer,
    rulesContext,
    setSelectedId,
    shareWithUser,
  });
}
