import type { FormEvent, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";
import type { ContainerNode } from "../types";

export type ExplorerModalState =
  | { mode: "create-child"; nodeId: string }
  | { mode: "delete"; nodeId: string }
  | { mode: "link-document"; documentLocalId: string }
  | { mode: "move"; nodeId: string }
  | { mode: "move-document"; documentLocalId: string }
  | { mode: "rename"; nodeId: string }
  | { mode: "share-peer"; nodeId: string };

export interface MoveTargetOption {
  id: string;
  label: string;
}

export function getMoveTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  movingNodeId: string,
): ReadonlyArray<MoveTargetOption> {
  const movingNode = nodes.find((node) => node.id === movingNodeId);
  if (!movingNode || movingNode.parentId === null) {
    return [];
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const options = nodes
    .filter((candidateNode) => {
      if (
        candidateNode.id === movingNode.id ||
        candidateNode.organizationId !== movingNode.organizationId
      ) {
        return false;
      }

      let currentNode: ContainerNode | undefined = candidateNode;
      while (currentNode) {
        if (currentNode.parentId === movingNode.id) {
          return false;
        }

        currentNode = currentNode.parentId
          ? nodesById.get(currentNode.parentId)
          : undefined;
      }

      return true;
    })
    .map((candidateNode) => ({
      id: candidateNode.id,
      label: `${candidateNode.name} (${candidateNode.id})`,
    }));

  options.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    }),
  );

  return options;
}

export function getDocumentMoveTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  documentLocalId: string,
): ReadonlyArray<MoveTargetOption> {
  const movingDocument = documentSummaries.find(
    (document) => document.id === documentLocalId,
  );
  if (!movingDocument?.containerId) {
    return [];
  }

  const currentContainer = nodes.find(
    (node) => node.id === movingDocument.containerId,
  );
  if (!currentContainer) {
    return [];
  }

  const options = nodes
    .filter(
      (candidateNode) =>
        candidateNode.id !== currentContainer.id &&
        candidateNode.organizationId === currentContainer.organizationId,
    )
    .map((candidateNode) => ({
      id: candidateNode.id,
      label: `${candidateNode.name} (${candidateNode.id})`,
    }));

  options.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    }),
  );

  return options;
}

export function getDocumentLinkTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  documentLocalId: string,
  linkedContainerIds: ReadonlyArray<string>,
): ReadonlyArray<MoveTargetOption> {
  const linkingDocument = documentSummaries.find(
    (document) => document.id === documentLocalId,
  );
  if (!linkingDocument?.containerId) {
    return [];
  }

  const currentContainer = nodes.find(
    (node) => node.id === linkingDocument.containerId,
  );
  if (!currentContainer) {
    return [];
  }

  const linkedContainerIdSet = new Set(linkedContainerIds);
  const options = nodes
    .filter(
      (candidateNode) =>
        candidateNode.organizationId === currentContainer.organizationId &&
        !linkedContainerIdSet.has(candidateNode.id),
    )
    .map((candidateNode) => ({
      id: candidateNode.id,
      label: `${candidateNode.name} (${candidateNode.id})`,
    }));

  options.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    }),
  );

  return options;
}

function getExplorerModalError(mode: ExplorerModalState["mode"]): string {
  switch (mode) {
    case "create-child":
      return "Failed to create child container.";
    case "rename":
      return "Failed to rename container.";
    case "delete":
      return "Failed to delete container.";
    case "link-document":
      return "Failed to link document.";
    case "move":
      return "Failed to move container.";
    case "move-document":
      return "Failed to move document.";
    case "share-peer":
      return "Failed to share container with peer.";
  }
}

function getExplorerModalLog(mode: ExplorerModalState["mode"]): string {
  switch (mode) {
    case "create-child":
      return "Failed to create child container:";
    case "rename":
      return "Failed to rename container:";
    case "delete":
      return "Failed to delete container:";
    case "link-document":
      return "Failed to link document:";
    case "move":
      return "Failed to move container:";
    case "move-document":
      return "Failed to move document:";
    case "share-peer":
      return "Failed to share container with peer:";
  }
}

function clearExplorerModalState(
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

async function submitExplorerDeleteModal(params: {
  clearModal: () => void;
  deleteContainer: (containerId: string) => Promise<boolean>;
  modalState: { mode: "delete"; nodeId: string };
  nodes: ReadonlyArray<ContainerNode>;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    clearModal,
    deleteContainer,
    modalState,
    nodes,
    setModalError,
    setSelectedId,
  } = params;
  const deletingNode = nodes.find((node) => node.id === modalState.nodeId);
  const deleted = await deleteContainer(modalState.nodeId);
  if (!deleted) {
    setModalError("Failed to delete container.");
    return;
  }

  setSelectedId(deletingNode?.parentId ?? null);
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
  const nextNode =
    modalState.mode === "create-child"
      ? await createChild(modalState.nodeId, draftName)
      : await renameContainer(modalState.nodeId, draftName);
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

function useExplorerModalEffects(params: {
  closeModal: () => void;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState | null;
  nameInputRef: RefObject<HTMLInputElement | null>;
}) {
  const { closeModal, isSubmittingModal, modalState, nameInputRef } = params;

  useEffect(() => {
    if (
      !modalState ||
      modalState.mode === "delete" ||
      modalState.mode === "link-document" ||
      modalState.mode === "move" ||
      modalState.mode === "move-document" ||
      modalState.mode === "share-peer"
    ) {
      return;
    }

    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [modalState, nameInputRef]);

  useEffect(() => {
    if (!modalState) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmittingModal) {
        event.preventDefault();
        closeModal();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeModal, isSubmittingModal, modalState]);
}

function useExplorerTargetModalOpeners(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
}) {
  const {
    documentSummaries,
    nodes,
    selectedDocumentLinkedContainerIds,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
  } = params;

  const openMoveModal = useCallback(
    (containerId: string) => {
      const moveTargetOptions = getMoveTargetOptions(nodes, containerId);
      if (moveTargetOptions.length === 0) {
        return;
      }

      setModalState({ mode: "move", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId(moveTargetOptions[0]?.id ?? "");
    },
    [
      nodes,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  const openMoveDocumentModal = useCallback(
    (documentLocalId: string) => {
      const moveTargetOptions = getDocumentMoveTargetOptions(
        nodes,
        documentSummaries,
        documentLocalId,
      );
      if (moveTargetOptions.length === 0) {
        return;
      }

      setModalState({ mode: "move-document", documentLocalId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId(moveTargetOptions[0]?.id ?? "");
    },
    [
      documentSummaries,
      nodes,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  const openLinkDocumentModal = useCallback(
    (documentLocalId: string) => {
      const linkTargetOptions = getDocumentLinkTargetOptions(
        nodes,
        documentSummaries,
        documentLocalId,
        selectedDocumentLinkedContainerIds,
      );
      if (linkTargetOptions.length === 0) {
        return;
      }

      setModalState({ mode: "link-document", documentLocalId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId(linkTargetOptions[0]?.id ?? "");
    },
    [
      documentSummaries,
      nodes,
      selectedDocumentLinkedContainerIds,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  return {
    openLinkDocumentModal,
    openMoveDocumentModal,
    openMoveModal,
  };
}

function useExplorerModalOpeners(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  setModalState: (state: ExplorerModalState | null) => void;
}) {
  const {
    nodes,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
  } = params;
  const targetOpeners = useExplorerTargetModalOpeners(params);

  const openCreateChildModal = useCallback(
    (parentId: string) => {
      setModalState({ mode: "create-child", nodeId: parentId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  const openRenameModal = useCallback(
    (containerId: string) => {
      const container = nodes.find((node) => node.id === containerId);
      if (!container) {
        return;
      }

      setModalState({ mode: "rename", nodeId: containerId });
      setModalError(null);
      setDraftName(container.name);
      setDraftTargetContainerId("");
    },
    [
      nodes,
      setDraftName,
      setDraftTargetContainerId,
      setModalError,
      setModalState,
    ],
  );

  const openDeleteModal = useCallback(
    (containerId: string) => {
      setModalState({ mode: "delete", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  const openSharePeerModal = useCallback(
    (containerId: string) => {
      setModalState({ mode: "share-peer", nodeId: containerId });
      setModalError(null);
      setDraftName("");
      setDraftTargetContainerId("");
    },
    [setDraftName, setDraftTargetContainerId, setModalError, setModalState],
  );

  return {
    ...targetOpeners,
    openCreateChildModal,
    openDeleteModal,
    openRenameModal,
    openSharePeerModal,
  };
}

function useExplorerModalState(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>,
) {
  const [modalState, setModalState] = useState<ExplorerModalState | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTargetContainerId, setDraftTargetContainerId] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const clearModal = useCallback(
    () =>
      clearExplorerModalState(
        setModalState,
        setModalError,
        setDraftName,
        setDraftTargetContainerId,
      ),
    [],
  );

  const closeModal = useCallback(() => {
    if (!isSubmittingModal) {
      clearModal();
    }
  }, [clearModal, isSubmittingModal]);
  const openers = useExplorerModalOpeners({
    documentSummaries,
    nodes,
    selectedDocumentLinkedContainerIds,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
    setModalState,
  });
  useExplorerModalEffects({
    closeModal,
    isSubmittingModal,
    modalState,
    nameInputRef,
  });

  return {
    ...openers,
    clearModal,
    closeModal,
    draftName,
    draftTargetContainerId,
    isSubmittingModal,
    modalError,
    modalState,
    nameInputRef,
    setDraftName,
    setDraftTargetContainerId,
    setIsSubmittingModal,
    setModalError,
  };
}

interface ExplorerModalSubmitParams {
  clearModal: () => void;
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  draftName: string;
  draftTargetContainerId: string;
  expandNode: (nodeId: string) => void;
  isSubmittingModal: boolean;
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
  setIsSubmittingModal: (value: boolean) => void;
  setModalError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

async function submitExplorerMoveDocumentModal(params: {
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

  const movedDocument =
    modalState.mode === "link-document"
      ? await linkDocument(modalState.documentLocalId, targetContainerId)
      : await moveDocument(modalState.documentLocalId, targetContainerId);
  if (!movedDocument) {
    setModalError(
      modalState.mode === "link-document"
        ? "Failed to link document."
        : "Failed to move document.",
    );
    return;
  }

  setSelectedId(movedDocument.id);
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
      await submitExplorerDeleteModal({
        clearModal: params.clearModal,
        deleteContainer: params.deleteContainer,
        modalState: params.modalState,
        nodes: params.nodes,
        setModalError: params.setModalError,
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
      await submitExplorerMoveDocumentModal({
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

function useExplorerModalAction(params: ExplorerModalSubmitParams) {
  const {
    clearModal,
    createChild,
    deleteContainer,
    draftName,
    draftTargetContainerId,
    expandNode,
    linkDocument,
    modalState,
    moveContainer,
    moveDocument,
    nodes,
    peerUserId,
    renameContainer,
    setModalError,
    setSelectedId,
    shareWithUser,
  } = params;

  return useCallback(async () => {
    if (!modalState) {
      return;
    }

    if (modalState.mode === "create-child" || modalState.mode === "rename") {
      await submitExplorerNameModal({
        clearModal,
        createChild,
        draftName,
        expandNode,
        modalState,
        renameContainer,
        setModalError,
        setSelectedId,
      });
      return;
    }

    await submitExplorerNonNameModal({
      clearModal,
      deleteContainer,
      draftTargetContainerId,
      linkDocument,
      modalState,
      moveContainer,
      moveDocument,
      nodes,
      peerUserId,
      setModalError,
      setSelectedId,
      shareWithUser,
    });
  }, [
    clearModal,
    createChild,
    deleteContainer,
    draftName,
    draftTargetContainerId,
    expandNode,
    linkDocument,
    modalState,
    moveContainer,
    moveDocument,
    nodes,
    peerUserId,
    renameContainer,
    setModalError,
    setSelectedId,
    shareWithUser,
  ]);
}

function useExplorerModalSubmit(params: ExplorerModalSubmitParams) {
  const { isSubmittingModal, modalState, setIsSubmittingModal, setModalError } =
    params;
  const submitModal = useExplorerModalAction(params);

  return useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!modalState || isSubmittingModal) {
        return;
      }

      setModalError(null);
      setIsSubmittingModal(true);

      try {
        await submitModal();
      } catch (error: unknown) {
        console.error(getExplorerModalLog(modalState.mode), error);
        setModalError(getExplorerModalError(modalState.mode));
      } finally {
        setIsSubmittingModal(false);
      }
    },
    [
      isSubmittingModal,
      modalState,
      submitModal,
      setIsSubmittingModal,
      setModalError,
    ],
  );
}

export function useExplorerModalController(params: {
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
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  setSelectedId: (id: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const modalState = useExplorerModalState(
    params.nodes,
    params.documentSummaries,
    params.selectedDocumentLinkedContainerIds,
  );
  const moveTargetOptions =
    modalState.modalState?.mode === "move"
      ? getMoveTargetOptions(params.nodes, modalState.modalState.nodeId)
      : modalState.modalState?.mode === "link-document"
        ? getDocumentLinkTargetOptions(
            params.nodes,
            params.documentSummaries,
            modalState.modalState.documentLocalId,
            params.selectedDocumentLinkedContainerIds,
          )
        : modalState.modalState?.mode === "move-document"
          ? getDocumentMoveTargetOptions(
              params.nodes,
              params.documentSummaries,
              modalState.modalState.documentLocalId,
            )
          : [];
  const handleModalSubmit = useExplorerModalSubmit({
    ...params,
    clearModal: modalState.clearModal,
    draftName: modalState.draftName,
    draftTargetContainerId: modalState.draftTargetContainerId,
    isSubmittingModal: modalState.isSubmittingModal,
    modalState: modalState.modalState,
    setIsSubmittingModal: modalState.setIsSubmittingModal,
    setModalError: modalState.setModalError,
  });

  return {
    closeModal: modalState.closeModal,
    draftName: modalState.draftName,
    draftTargetContainerId: modalState.draftTargetContainerId,
    handleModalSubmit,
    isSubmittingModal: modalState.isSubmittingModal,
    modalError: modalState.modalError,
    modalState: modalState.modalState,
    moveTargetOptions,
    nameInputRef: modalState.nameInputRef,
    openCreateChildModal: modalState.openCreateChildModal,
    openDeleteModal: modalState.openDeleteModal,
    openLinkDocumentModal: modalState.openLinkDocumentModal,
    openMoveDocumentModal: modalState.openMoveDocumentModal,
    openMoveModal: modalState.openMoveModal,
    openRenameModal: modalState.openRenameModal,
    openSharePeerModal: modalState.openSharePeerModal,
    setDraftName: modalState.setDraftName,
    setDraftTargetContainerId: modalState.setDraftTargetContainerId,
    setModalError: modalState.setModalError,
  };
}

function getExplorerModalTitle(modalState: ExplorerModalState): string {
  switch (modalState.mode) {
    case "delete":
      return "Delete Container";
    case "link-document":
      return "Link Document";
    case "move":
      return "Move Container";
    case "move-document":
      return "Move Document";
    case "share-peer":
      return "Share Container";
    case "rename":
      return "Rename Container";
    case "create-child":
      return "Create Child";
  }
}

function getExplorerModalSubmitLabel(
  modalState: ExplorerModalState,
  isSubmittingModal: boolean,
): string {
  if (!isSubmittingModal) {
    switch (modalState.mode) {
      case "delete":
        return "Delete";
      case "link-document":
        return "Link";
      case "move":
        return "Move";
      case "move-document":
        return "Move";
      case "share-peer":
        return "Share";
      case "rename":
        return "Rename";
      case "create-child":
        return "Create";
    }
  }

  switch (modalState.mode) {
    case "delete":
      return "Deleting...";
    case "link-document":
      return "Linking...";
    case "move":
      return "Moving...";
    case "move-document":
      return "Moving...";
    case "share-peer":
      return "Sharing...";
    case "rename":
      return "Renaming...";
    case "create-child":
      return "Creating...";
  }
}

function isExplorerModalSubmitDisabled(params: {
  draftName: string;
  draftTargetContainerId: string;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState;
  peerUserId: string | null;
}): boolean {
  const {
    draftName,
    draftTargetContainerId,
    isSubmittingModal,
    modalState,
    peerUserId,
  } = params;
  if (isSubmittingModal) {
    return true;
  }

  const nameIsRequired =
    modalState.mode !== "delete" &&
    modalState.mode !== "link-document" &&
    modalState.mode !== "move" &&
    modalState.mode !== "move-document" &&
    modalState.mode !== "share-peer";
  if (nameIsRequired && draftName.trim().length === 0) {
    return true;
  }

  if (
    (modalState.mode === "link-document" ||
      modalState.mode === "move" ||
      modalState.mode === "move-document") &&
    draftTargetContainerId.length === 0
  ) {
    return true;
  }

  if (modalState.mode === "share-peer" && !peerUserId) {
    return true;
  }

  return false;
}

function ExplorerModalBody(params: {
  draftName: string;
  draftTargetContainerId: string;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState;
  moveTargetOptions: ReadonlyArray<MoveTargetOption>;
  nameInputRef: RefObject<HTMLInputElement | null>;
  peerUserId: string | null;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
}) {
  const {
    draftName,
    draftTargetContainerId,
    isSubmittingModal,
    modalState,
    moveTargetOptions,
    nameInputRef,
    peerUserId,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
  } = params;

  if (modalState.mode === "delete") {
    return <div className="explorer-modal-copy">Delete this container?</div>;
  }

  if (modalState.mode === "share-peer") {
    return (
      <div className="explorer-modal-copy">
        {peerUserId
          ? `Share this container with peer user ${peerUserId}?`
          : "No peer user is available."}
      </div>
    );
  }

  if (
    modalState.mode === "link-document" ||
    modalState.mode === "move" ||
    modalState.mode === "move-document"
  ) {
    return (
      <label className="explorer-modal-field">
        Destination
        <select
          aria-label="Destination container"
          disabled={isSubmittingModal}
          value={draftTargetContainerId}
          onChange={(event) => {
            setModalError(null);
            setDraftTargetContainerId(event.target.value);
          }}
        >
          {moveTargetOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="explorer-modal-field">
      Name
      <input
        ref={nameInputRef}
        aria-label="Container name"
        disabled={isSubmittingModal}
        value={draftName}
        onChange={(event) => {
          setModalError(null);
          setDraftName(event.target.value);
        }}
      />
    </label>
  );
}

export function ExplorerModalLayer(params: {
  closeModal: () => void;
  draftName: string;
  draftTargetContainerId: string;
  handleModalSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSubmittingModal: boolean;
  modalError: string | null;
  modalState: ExplorerModalState | null;
  moveTargetOptions: ReadonlyArray<MoveTargetOption>;
  nameInputRef: RefObject<HTMLInputElement | null>;
  peerUserId: string | null;
  setDraftName: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
}) {
  const {
    closeModal,
    draftName,
    draftTargetContainerId,
    handleModalSubmit,
    isSubmittingModal,
    modalError,
    modalState,
    moveTargetOptions,
    nameInputRef,
    peerUserId,
    setDraftName,
    setDraftTargetContainerId,
    setModalError,
  } = params;

  if (!modalState) {
    return null;
  }

  return (
    <div className="explorer-modal-backdrop" role="presentation">
      <div
        className="explorer-modal"
        role="dialog"
        aria-labelledby="explorer-modal-title"
        aria-modal="true"
      >
        <form className="explorer-modal-form" onSubmit={handleModalSubmit}>
          <h2 id="explorer-modal-title">{getExplorerModalTitle(modalState)}</h2>
          <ExplorerModalBody
            draftName={draftName}
            draftTargetContainerId={draftTargetContainerId}
            isSubmittingModal={isSubmittingModal}
            modalState={modalState}
            moveTargetOptions={moveTargetOptions}
            nameInputRef={nameInputRef}
            peerUserId={peerUserId}
            setDraftName={setDraftName}
            setDraftTargetContainerId={setDraftTargetContainerId}
            setModalError={setModalError}
          />
          {modalError && (
            <div className="explorer-modal-error">{modalError}</div>
          )}
          <div className="explorer-modal-actions">
            <button
              type="button"
              disabled={isSubmittingModal}
              onClick={closeModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isExplorerModalSubmitDisabled({
                draftName,
                draftTargetContainerId,
                isSubmittingModal,
                modalState,
                peerUserId,
              })}
            >
              {getExplorerModalSubmitLabel(modalState, isSubmittingModal)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
