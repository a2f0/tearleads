import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { getExplorerModalError, getExplorerModalLog } from "./labels";
import type { ExplorerModalMutationParams, ExplorerModalState } from "./types";

export interface ExplorerModalSubmitParams extends ExplorerModalMutationParams {
  clearModal: () => void;
  draftName: string;
  draftTargetContainerId: string;
  modalState: ExplorerModalState | null;
  setBackgroundActionError: (error: string | null) => void;
  setModalError: (error: string | null) => void;
}

function submitExplorerPurgeModal(params: {
  clearModal: () => void;
  modalState: { mode: "purge"; nodeId: string };
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  setBackgroundActionError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  startContainerPurge: (containerId: string) => void;
}) {
  const {
    clearModal,
    modalState,
    nodes,
    online,
    setBackgroundActionError,
    setSelectedId,
    startContainerPurge,
  } = params;
  // Permanent deletion is online-only (there is no offline delete outbox — moves
  // to Trash are the reversible, offline-capable path). Fail fast with a clear
  // message rather than opening the progress modal only to have it fail.
  if (!online) {
    setBackgroundActionError(
      "You must be online to permanently delete this folder.",
    );
    clearModal();
    return;
  }
  // Re-select the folder's parent so the detail pane doesn't linger on the
  // subtree being torn down, then hand off to the long-running purge run (which
  // owns the progress + cancel modal) and close this confirm modal.
  const purgingNode = nodes.find((node) => node.id === modalState.nodeId);
  setSelectedId(purgingNode?.parentId ?? null);
  startContainerPurge(modalState.nodeId);
  clearModal();
}

function submitExplorerEmptyTrashModal(params: {
  clearModal: () => void;
  modalState: { mode: "empty-trash"; nodeId: string };
  online: boolean;
  setBackgroundActionError: (error: string | null) => void;
  startEmptyTrash: (trashContainerId: string) => void;
}) {
  const {
    clearModal,
    modalState,
    online,
    setBackgroundActionError,
    startEmptyTrash,
  } = params;
  if (!online) {
    setBackgroundActionError("You must be online to empty the Trash.");
    clearModal();
    return;
  }
  startEmptyTrash(modalState.nodeId);
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
  canShareWithPeer: boolean;
  clearModal: () => void;
  modalState: { mode: "share-peer"; nodeId: string };
  peerUserId: string | null;
  setModalError: (error: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const {
    canShareWithPeer,
    clearModal,
    modalState,
    peerUserId,
    setModalError,
    shareWithUser,
  } = params;
  if (!canShareWithPeer) {
    setModalError("Peer sharing is not available.");
    return;
  }

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
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  modalState:
    | { mode: "link-document"; documentLocalId: string }
    | { mode: "move-document"; documentLocalId: string };
  moveDocument: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  setBackgroundActionError: (error: string | null) => void;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  targetContainerId: string;
}) {
  const {
    clearModal,
    linkDocument,
    modalState,
    moveDocument,
    setBackgroundActionError,
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
  setSelectedId(modalState.documentLocalId);
  void movedDocumentPromise
    .then((movedDocument) => {
      if (movedDocument) {
        if (movedDocument.id !== modalState.documentLocalId) {
          setSelectedId(movedDocument.id);
        }
        return;
      }

      const message = getExplorerModalError(modalState.mode);
      setBackgroundActionError(message);
      console.error(message);
    })
    .catch((error: unknown) => {
      setBackgroundActionError(getExplorerModalError(modalState.mode));
      console.error(getExplorerModalLog(modalState.mode), error);
    });
  clearModal();
}

export async function submitExplorerModalAction(
  params: ExplorerModalSubmitParams,
) {
  const { modalState } = params;
  if (!modalState) {
    return;
  }

  switch (modalState.mode) {
    case "create-child":
    case "rename":
      await submitExplorerNameModal({
        clearModal: params.clearModal,
        createChild: params.createChild,
        draftName: params.draftName,
        expandNode: params.expandNode,
        modalState,
        renameContainer: params.renameContainer,
        setModalError: params.setModalError,
        setSelectedId: params.setSelectedId,
      });
      return;
    case "purge":
      submitExplorerPurgeModal({
        clearModal: params.clearModal,
        modalState,
        nodes: params.nodes,
        online: params.online,
        setBackgroundActionError: params.setBackgroundActionError,
        setSelectedId: params.setSelectedId,
        startContainerPurge: params.startContainerPurge,
      });
      return;
    case "empty-trash":
      submitExplorerEmptyTrashModal({
        clearModal: params.clearModal,
        modalState,
        online: params.online,
        setBackgroundActionError: params.setBackgroundActionError,
        startEmptyTrash: params.startEmptyTrash,
      });
      return;
    case "move":
      await submitExplorerMoveModal({
        clearModal: params.clearModal,
        modalState,
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
        modalState,
        moveDocument: params.moveDocument,
        setBackgroundActionError: params.setBackgroundActionError,
        setModalError: params.setModalError,
        setSelectedId: params.setSelectedId,
        targetContainerId: params.draftTargetContainerId,
      });
      return;
    case "share-peer":
      await submitExplorerShareModal({
        canShareWithPeer: params.canShareWithPeer,
        clearModal: params.clearModal,
        modalState,
        peerUserId: params.peerUserId,
        setModalError: params.setModalError,
        shareWithUser: params.shareWithUser,
      });
      return;
  }
}
