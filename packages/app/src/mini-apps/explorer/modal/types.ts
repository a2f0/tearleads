import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type { DocumentSummary } from "../../../data/documentSummary";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../../stores/explorer/containerInfo";
import type { MoveTargetOption } from "../targetOptions";
import type { ContainerNode } from "../types";

export type ExplorerModalState =
  | { mode: "container-info"; nodeId: string }
  | { mode: "create-child"; nodeId: string }
  | { mode: "delete"; nodeId: string }
  | { mode: "link-document"; documentLocalId: string }
  | { mode: "move"; nodeId: string }
  | { mode: "move-document"; documentLocalId: string }
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
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  moveDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  nodes: ReadonlyArray<ContainerNode>;
  peerUserId: string | null;
  loadContainerInfo: (containerId: string) => Promise<ExplorerContainerInfo>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  setSelectedId: (id: string | null) => void;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ExplorerContainerShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

export interface ExplorerModalController {
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
