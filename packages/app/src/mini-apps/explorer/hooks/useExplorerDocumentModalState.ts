import type { DocumentSummary } from "@tearleads/client-sdk";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { useExplorerModalController } from "../modal/controller";
import type { ExplorerModalState } from "../modal/types";
import type { ExplorerContainerRulesContext } from "../model/containerRules";
import type { MoveTargetOption } from "../model/targetOptions";
import type {
  ExplorerDocumentMutationAction,
  ExplorerModelExplorer,
} from "./explorerModelTypes";

export interface ExplorerDocumentModalState {
  backgroundActionError: string | null;
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
  openEmptyTrashModal: (nodeId: string) => void;
  openLinkDocumentModal: (documentLocalId: string) => void;
  openMoveDocumentModal: (documentLocalId: string) => void;
  openMoveModal: (nodeId: string) => void;
  openPurgeModal: (nodeId: string) => void;
  openRenameModal: (nodeId: string) => void;
  openSharePeerModal: (nodeId: string) => void;
  setDraftName: Dispatch<SetStateAction<string>>;
  setDraftTargetContainerId: Dispatch<SetStateAction<string>>;
  setModalError: Dispatch<SetStateAction<string | null>>;
  targetSelectRef: RefObject<HTMLButtonElement | null>;
}

export function useExplorerDocumentModalState(params: {
  explorer: ExplorerModelExplorer;
  linkDocument: ExplorerDocumentMutationAction;
  moveDocument: ExplorerDocumentMutationAction;
  canShareWithPeer: boolean;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  online: boolean;
  peerUserId: string | null;
  rulesContext: ExplorerContainerRulesContext;
  setSelectedId: (id: string | null) => void;
  selectionExpandNode: (nodeId: string) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  startContainerPurge: (containerId: string) => void;
  startEmptyTrash: (trashContainerId: string) => void;
}): ExplorerDocumentModalState {
  const {
    explorer,
    linkDocument,
    moveDocument,
    canShareWithPeer,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    online,
    peerUserId,
    rulesContext,
    setSelectedId,
    selectionExpandNode,
    shareWithUser,
    startContainerPurge,
    startEmptyTrash,
  } = params;

  return useExplorerModalController({
    createChild: explorer.createChild,
    expandNode: selectionExpandNode,
    linkDocument,
    moveContainer: explorer.moveContainer,
    moveDocument,
    nodes: explorer.nodes,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    canShareWithPeer,
    online,
    peerUserId,
    startContainerPurge,
    startEmptyTrash,
    renameContainer: explorer.renameContainer,
    rulesContext,
    setSelectedId,
    shareWithUser,
  });
}
