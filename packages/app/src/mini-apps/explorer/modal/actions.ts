import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { getExplorerModalError, getExplorerModalLog } from "./labels";
import type { ExplorerModalState } from "./types";

export interface ExplorerModalSubmitParams {
  clearModal: () => void;
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  draftName: string;
  draftTargetContainerId: string;
  expandNode: (nodeId: string) => void;
  linkDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  modalState: ExplorerModalState | null;
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
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

function submitExplorerDeleteModal(params: {
  clearModal: () => void;
  deleteContainer: (containerId: string) => Promise<boolean>;
  modalState: { mode: "delete"; nodeId: string };
  nodes: ReadonlyArray<ContainerNode>;
  setSelectedId: (id: string | null) => void;
}) {
  const { clearModal, deleteContainer, modalState, nodes, setSelectedId } =
    params;
  const deletingNode = nodes.find((node) => node.id === modalState.nodeId);
  void deleteContainer(modalState.nodeId)
    .then((deleted) => {
      if (deleted) {
        setSelectedId(deletingNode?.parentId ?? null);
        return;
      }

      console.error(getExplorerModalError(modalState.mode));
    })
    .catch((error: unknown) => {
      console.error(getExplorerModalLog(modalState.mode), error);
    });
  clearModal();
}

async function submitExplorerMoveModal(params: {
  clearModal: () => void;
  modalState: { mode: "move"; nodeId: string };
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  targetContainerId: string;
}) {
  const {
    clearModal,
    modalState,
    moveContainer,
    setModalError,
    setSelectedId,
    targetContainerId,
  } = params;

  if (!targetContainerId) {
    setModalError("Choose a destination container.");
    return;
  }

  const movedNode = await moveContainer(modalState.nodeId, targetContainerId);
  if (!movedNode) {
    setModalError("Failed to move container.");
    return;
  }

  setSelectedId(movedNode.id);
  clearModal();
}

async function submitExplorerShareModal(params: {
  clearModal: () => void;
  modalState: { mode: "share-peer"; nodeId: string };
  peerUserId: string | null;
  setModalError: (error: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const { clearModal, modalState, peerUserId, setModalError, shareWithUser } =
    params;
  if (!peerUserId) {
    setModalError("No peer user is available.");
    return;
  }

  const shared = await shareWithUser(modalState.nodeId, peerUserId);
  if (!shared) {
    setModalError("Failed to share container with peer.");
    return;
  }

  clearModal();
}

async function submitExplorerNameModal(params: {
  clearModal: () => void;
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  draftName: string;
  expandNode: (nodeId: string) => void;
  modalState:
    | { mode: "create-child"; nodeId: string }
    | { mode: "rename"; nodeId: string };
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    clearModal,
    createChild,
    draftName,
    expandNode,
    modalState,
    renameContainer,
    setModalError,
    setSelectedId,
  } = params;
  const trimmedName = draftName.trim();
  const nextNode =
    modalState.mode === "create-child"
      ? await createChild(modalState.nodeId, trimmedName)
      : await renameContainer(modalState.nodeId, trimmedName);
  if (!nextNode) {
    setModalError(getExplorerModalError(modalState.mode));
    return;
  }

  setSelectedId(nextNode.id);
  if (modalState.mode === "create-child") {
    expandNode(modalState.nodeId);
  }
  clearModal();
}

function submitExplorerMoveDocumentModal(params: {
  clearModal: () => void;
  linkDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  modalState:
    | { mode: "link-document"; documentLocalId: string }
    | { mode: "move-document"; documentLocalId: string };
  moveDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  targetContainerId: string;
}) {
  const {
    clearModal,
    linkDocument,
    modalState,
    moveDocument,
    setModalError,
    setSelectedId,
    targetContainerId,
  } = params;

  if (!targetContainerId) {
    setModalError("Choose a destination container.");
    return;
  }

  const movedDocumentPromise =
    modalState.mode === "link-document"
      ? linkDocument(modalState.documentLocalId, targetContainerId)
      : moveDocument(modalState.documentLocalId, targetContainerId);
  void movedDocumentPromise
    .then((movedDocument) => {
      if (movedDocument) {
        setSelectedId(movedDocument.id);
        return;
      }

      console.error(getExplorerModalError(modalState.mode));
    })
    .catch((error: unknown) => {
      console.error(getExplorerModalLog(modalState.mode), error);
    });
  clearModal();
}

async function submitExplorerNonNameModal(params: {
  clearModal: () => void;
  deleteContainer: (containerId: string) => Promise<boolean>;
  draftTargetContainerId: string;
  linkDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  modalState:
    | { mode: "delete"; nodeId: string }
    | { mode: "link-document"; documentLocalId: string }
    | { mode: "move"; nodeId: string }
    | { mode: "move-document"; documentLocalId: string }
    | { mode: "share-peer"; nodeId: string };
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
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  switch (params.modalState.mode) {
    case "delete":
      submitExplorerDeleteModal({
        clearModal: params.clearModal,
        deleteContainer: params.deleteContainer,
        modalState: params.modalState,
        nodes: params.nodes,
        setSelectedId: params.setSelectedId,
      });
      return;
    case "move":
      await submitExplorerMoveModal({
        clearModal: params.clearModal,
        modalState: params.modalState,
        moveContainer: params.moveContainer,
        setModalError: params.setModalError,
        setSelectedId: params.setSelectedId,
        targetContainerId: params.draftTargetContainerId,
      });
      return;
    case "link-document":
    case "move-document":
      submitExplorerMoveDocumentModal({
        clearModal: params.clearModal,
        linkDocument: params.linkDocument,
        modalState: params.modalState,
        moveDocument: params.moveDocument,
        setModalError: params.setModalError,
        setSelectedId: params.setSelectedId,
        targetContainerId: params.draftTargetContainerId,
      });
      return;
    case "share-peer":
      await submitExplorerShareModal({
        clearModal: params.clearModal,
        modalState: params.modalState,
        peerUserId: params.peerUserId,
        setModalError: params.setModalError,
        shareWithUser: params.shareWithUser,
      });
      return;
  }
}

export async function submitExplorerModalAction(
  params: ExplorerModalSubmitParams,
) {
  if (!params.modalState) {
    return;
  }

  if (
    params.modalState.mode === "create-child" ||
    params.modalState.mode === "rename"
  ) {
    await submitExplorerNameModal({
      clearModal: params.clearModal,
      createChild: params.createChild,
      draftName: params.draftName,
      expandNode: params.expandNode,
      modalState: params.modalState,
      renameContainer: params.renameContainer,
      setModalError: params.setModalError,
      setSelectedId: params.setSelectedId,
    });
    return;
  }

  await submitExplorerNonNameModal({
    clearModal: params.clearModal,
    deleteContainer: params.deleteContainer,
    draftTargetContainerId: params.draftTargetContainerId,
    linkDocument: params.linkDocument,
    modalState: params.modalState,
    moveContainer: params.moveContainer,
    moveDocument: params.moveDocument,
    nodes: params.nodes,
    peerUserId: params.peerUserId,
    setModalError: params.setModalError,
    setSelectedId: params.setSelectedId,
    shareWithUser: params.shareWithUser,
  });
}
