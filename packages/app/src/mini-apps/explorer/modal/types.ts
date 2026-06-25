import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type { ExplorerContainerRulesContext } from "../containerRules";
import type { MoveTargetOption } from "../targetOptions";

export type ExplorerModalState =
  | { mode: "create-child"; nodeId: string }
  | { mode: "delete"; nodeId: string }
  | { mode: "link-document"; documentLocalId: string }
  | { mode: "move"; nodeId: string }
  | { mode: "move-document"; documentLocalId: string }
  | { mode: "purge"; nodeId: string }
  | { mode: "rename"; nodeId: string }
  | { mode: "share-peer"; nodeId: string };

export interface ExplorerModalControllerParams {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  linkDocument: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  moveDocument: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  nodes: ReadonlyArray<ContainerNode>;
  peerUserId: string | null;
  purgeContainer: (containerId: string) => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  rulesContext: ExplorerContainerRulesContext;
  // Linked containers per document id, so link targets are computed for whatever
  // document a modal operates on (selection or right-clicked row) rather than a
  // single pre-selected document.
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  setSelectedId: (id: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

export interface ExplorerModalController {
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
  openDeleteModal: (nodeId: string) => void;
  openLinkDocumentModal: (documentLocalId: string) => void;
  openMoveDocumentModal: (documentLocalId: string) => void;
  openMoveModal: (nodeId: string) => void;
  openPurgeModal: (nodeId: string) => void;
  openRenameModal: (nodeId: string) => void;
  openSharePeerModal: (nodeId: string) => void;
  setDraftName: Dispatch<SetStateAction<string>>;
  setDraftTargetContainerId: Dispatch<SetStateAction<string>>;
  setModalError: Dispatch<SetStateAction<string | null>>;
  targetSelectRef: RefObject<HTMLSelectElement | null>;
}
