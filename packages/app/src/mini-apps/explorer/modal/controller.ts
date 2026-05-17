import type { FormEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentSummary } from "../../../data/documentSummary";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../../stores/explorer/containerInfo";
import {
  createExplorerTargetLookups,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
  getMoveTargetOptions,
} from "../targetOptions";
import type { ContainerNode } from "../types";
import {
  type ExplorerModalSubmitParams,
  submitExplorerModalAction,
} from "./actions";
import { getExplorerModalError, getExplorerModalLog } from "./labels";
import { clearExplorerModalState, useExplorerModalOpeners } from "./openers";
import type {
  ExplorerModalController,
  ExplorerModalControllerParams,
  ExplorerModalState,
} from "./types";

type ExplorerContainerInfoGrant = NonNullable<
  ExplorerContainerInfo["remoteInfo"]
>["grants"][number];

function upsertContainerInfoGrant(
  info: ExplorerContainerInfo,
  grant: ExplorerContainerInfoGrant | null,
): ExplorerContainerInfo {
  if (!grant || !info.remoteInfo) {
    return info;
  }

  const existingGrants = info.remoteInfo.grants ?? [];
  const existingGrantIndex = existingGrants.findIndex(
    (candidate) =>
      candidate.subjectType === grant.subjectType &&
      candidate.subjectId === grant.subjectId,
  );
  const grants =
    existingGrantIndex === -1
      ? [...existingGrants, grant]
      : existingGrants.map((candidate, index) =>
          index === existingGrantIndex ? { ...candidate, ...grant } : candidate,
        );

  return {
    ...info,
    remoteInfo: {
      ...info.remoteInfo,
      grants,
    },
  };
}

function useExplorerModalEffects(params: {
  closeModal: () => void;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState | null;
  nameInputRef: RefObject<HTMLInputElement | null>;
  targetSelectRef: RefObject<HTMLSelectElement | null>;
}) {
  const {
    closeModal,
    isSubmittingModal,
    modalState,
    nameInputRef,
    targetSelectRef,
  } = params;

  useEffect(() => {
    if (!modalState) {
      return;
    }

    if (modalState.mode === "create-child" || modalState.mode === "rename") {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
      return;
    }

    if (
      modalState.mode === "link-document" ||
      modalState.mode === "move" ||
      modalState.mode === "move-document"
    ) {
      targetSelectRef.current?.focus();
    }
  }, [modalState, nameInputRef, targetSelectRef]);

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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Modal state spans shared modal fields, async info loading, focus, and openers.
function useExplorerModalState(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>,
  loadContainerInfo: (containerId: string) => Promise<ExplorerContainerInfo>,
) {
  const [modalState, setModalState] = useState<ExplorerModalState | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);
  const [isLoadingContainerInfo, setIsLoadingContainerInfo] = useState(false);
  const [containerInfo, setContainerInfo] =
    useState<ExplorerContainerInfo | null>(null);
  const [containerInfoError, setContainerInfoError] = useState<string | null>(
    null,
  );
  const [draftName, setDraftName] = useState("");
  const [draftTargetContainerId, setDraftTargetContainerId] = useState("");
  const [draftShareGroupId, setDraftShareGroupId] = useState("");
  const [draftShareAccessLevel, setDraftShareAccessLevel] =
    useState<ExplorerContainerShareAccessLevel>("write");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const targetSelectRef = useRef<HTMLSelectElement>(null);
  const targetLookups = useMemo(
    () => createExplorerTargetLookups(nodes, documentSummaries),
    [documentSummaries, nodes],
  );
  const resetContainerInfoState = useCallback(() => {
    setContainerInfo(null);
    setContainerInfoError(null);
    setDraftShareGroupId("");
    setDraftShareAccessLevel("write");
    setIsLoadingContainerInfo(false);
  }, []);
  const clearModal = useCallback(() => {
    clearExplorerModalState(
      setModalState,
      setModalError,
      setDraftName,
      setDraftTargetContainerId,
    );
    resetContainerInfoState();
  }, [resetContainerInfoState]);

  const reloadContainerInfo = useCallback(
    async (
      containerId: string,
      optimisticGrant: ExplorerContainerInfoGrant | null = null,
    ) => {
      setIsLoadingContainerInfo(true);
      setContainerInfoError(null);
      try {
        const nextInfo = await loadContainerInfo(containerId);
        const updatedInfo = upsertContainerInfoGrant(nextInfo, optimisticGrant);
        setContainerInfo(updatedInfo);
        setDraftShareGroupId((current) => {
          const groups = updatedInfo.remoteInfo?.groups ?? [];
          const currentGroupIsShareable = groups.some(
            (group) => group.groupId === current && group.currentState,
          );
          if (currentGroupIsShareable) {
            return current;
          }

          return groups.find((group) => group.currentState)?.groupId ?? "";
        });
      } catch (error) {
        setContainerInfo(null);
        setContainerInfoError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsLoadingContainerInfo(false);
      }
    },
    [loadContainerInfo],
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
    targetLookups,
  });
  useExplorerModalEffects({
    closeModal,
    isSubmittingModal,
    modalState,
    nameInputRef,
    targetSelectRef,
  });

  useEffect(() => {
    if (modalState?.mode !== "container-info") {
      return;
    }

    let cancelled = false;
    setIsLoadingContainerInfo(true);
    setContainerInfoError(null);
    setContainerInfo(null);
    setDraftShareGroupId("");
    setDraftShareAccessLevel("write");

    loadContainerInfo(modalState.nodeId)
      .then((nextInfo) => {
        if (cancelled) {
          return;
        }

        setContainerInfo(nextInfo);
        setDraftShareGroupId(
          nextInfo.remoteInfo?.groups.find((group) => group.currentState)
            ?.groupId ?? "",
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setContainerInfoError(
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingContainerInfo(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadContainerInfo, modalState]);

  return {
    ...openers,
    clearModal,
    closeModal,
    containerInfo,
    containerInfoError,
    draftName,
    draftShareAccessLevel,
    draftShareGroupId,
    draftTargetContainerId,
    isLoadingContainerInfo,
    isSubmittingModal,
    modalError,
    modalState,
    nameInputRef,
    targetLookups,
    targetSelectRef,
    reloadContainerInfo,
    setDraftName,
    setDraftShareAccessLevel,
    setDraftShareGroupId,
    setDraftTargetContainerId,
    setIsSubmittingModal,
    setModalError,
  };
}

interface ExplorerModalSubmitControllerParams
  extends ExplorerModalSubmitParams {
  draftShareAccessLevel: ExplorerContainerShareAccessLevel;
  draftShareGroupId: string;
  isSubmittingModal: boolean;
  reloadContainerInfo: (
    containerId: string,
    optimisticGrant?: ExplorerContainerInfoGrant | null,
  ) => Promise<void>;
  setIsSubmittingModal: (value: boolean) => void;
  shareWithGroup: ExplorerModalControllerParams["shareWithGroup"];
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Submit handling dispatches the existing modal action surface from one form.
function useExplorerModalSubmit(params: ExplorerModalSubmitControllerParams) {
  const {
    clearModal,
    createChild,
    deleteContainer,
    draftName,
    draftShareAccessLevel,
    draftShareGroupId,
    draftTargetContainerId,
    expandNode,
    isSubmittingModal,
    linkDocument,
    modalState,
    moveContainer,
    moveDocument,
    nodes,
    peerUserId,
    renameContainer,
    reloadContainerInfo,
    setIsSubmittingModal,
    setModalError,
    setSelectedId,
    shareWithGroup,
    shareWithUser,
  } = params;

  return useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!modalState || isSubmittingModal) {
        return;
      }

      setModalError(null);
      setIsSubmittingModal(true);

      try {
        if (modalState.mode === "container-info") {
          if (!draftShareGroupId) {
            setModalError("Choose a group.");
            return;
          }

          const shared = await shareWithGroup(
            modalState.nodeId,
            draftShareGroupId,
            draftShareAccessLevel,
          );
          if (!shared) {
            setModalError("Failed to share container with group.");
            return;
          }

          await reloadContainerInfo(modalState.nodeId, {
            accessLevel: draftShareAccessLevel,
            subjectId: draftShareGroupId,
            subjectType: "group",
          });
          return;
        }

        await submitExplorerModalAction({
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
        });
      } catch (error: unknown) {
        console.error(getExplorerModalLog(modalState.mode), error);
        setModalError(getExplorerModalError(modalState.mode));
      } finally {
        setIsSubmittingModal(false);
      }
    },
    [
      clearModal,
      createChild,
      deleteContainer,
      draftName,
      draftShareAccessLevel,
      draftShareGroupId,
      draftTargetContainerId,
      expandNode,
      isSubmittingModal,
      linkDocument,
      modalState,
      moveContainer,
      moveDocument,
      nodes,
      peerUserId,
      renameContainer,
      reloadContainerInfo,
      setIsSubmittingModal,
      setModalError,
      setSelectedId,
      shareWithGroup,
      shareWithUser,
    ],
  );
}

function useContainerInfoPeerShare(params: {
  clearModal: () => void;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState | null;
  peerUserId: string | null;
  setIsSubmittingModal: (value: boolean) => void;
  setModalError: (error: string | null) => void;
  shareWithUser: ExplorerModalControllerParams["shareWithUser"];
}) {
  const {
    clearModal,
    isSubmittingModal,
    modalState,
    peerUserId,
    setIsSubmittingModal,
    setModalError,
    shareWithUser,
  } = params;

  return useCallback(async () => {
    if (
      modalState?.mode !== "container-info" ||
      isSubmittingModal ||
      !peerUserId
    ) {
      return;
    }

    setModalError(null);
    setIsSubmittingModal(true);
    try {
      const shared = await shareWithUser(modalState.nodeId, peerUserId);
      if (!shared) {
        setModalError("Failed to share container with peer.");
        return;
      }

      clearModal();
    } catch (error) {
      console.error("Failed to share container with peer:", error);
      setModalError("Failed to share container with peer.");
    } finally {
      setIsSubmittingModal(false);
    }
  }, [
    clearModal,
    isSubmittingModal,
    modalState,
    peerUserId,
    setIsSubmittingModal,
    setModalError,
    shareWithUser,
  ]);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The controller aggregates modal state, target options, and submit handlers for the view.
export function useExplorerModalController(
  params: ExplorerModalControllerParams,
): ExplorerModalController {
  const modalState = useExplorerModalState(
    params.nodes,
    params.documentSummaries,
    params.selectedDocumentLinkedContainerIds,
    params.loadContainerInfo,
  );
  const moveTargetOptions = useMemo(() => {
    if (modalState.modalState?.mode === "move") {
      return getMoveTargetOptions(
        params.nodes,
        modalState.modalState.nodeId,
        modalState.targetLookups,
      );
    }

    if (modalState.modalState?.mode === "link-document") {
      return getDocumentLinkTargetOptions(
        params.nodes,
        params.documentSummaries,
        modalState.modalState.documentLocalId,
        params.selectedDocumentLinkedContainerIds,
        modalState.targetLookups,
      );
    }

    if (modalState.modalState?.mode === "move-document") {
      return getDocumentMoveTargetOptions(
        params.nodes,
        params.documentSummaries,
        modalState.modalState.documentLocalId,
        modalState.targetLookups,
      );
    }

    return [];
  }, [
    modalState.modalState,
    modalState.targetLookups,
    params.documentSummaries,
    params.nodes,
    params.selectedDocumentLinkedContainerIds,
  ]);
  const handleModalSubmit = useExplorerModalSubmit({
    ...params,
    clearModal: modalState.clearModal,
    draftName: modalState.draftName,
    draftShareAccessLevel: modalState.draftShareAccessLevel,
    draftShareGroupId: modalState.draftShareGroupId,
    draftTargetContainerId: modalState.draftTargetContainerId,
    isSubmittingModal: modalState.isSubmittingModal,
    modalState: modalState.modalState,
    reloadContainerInfo: modalState.reloadContainerInfo,
    setIsSubmittingModal: modalState.setIsSubmittingModal,
    setModalError: modalState.setModalError,
  });
  const handleContainerInfoPeerShare = useContainerInfoPeerShare({
    clearModal: modalState.clearModal,
    isSubmittingModal: modalState.isSubmittingModal,
    modalState: modalState.modalState,
    peerUserId: params.peerUserId,
    setIsSubmittingModal: modalState.setIsSubmittingModal,
    setModalError: modalState.setModalError,
    shareWithUser: params.shareWithUser,
  });

  return {
    closeModal: modalState.closeModal,
    containerInfo: modalState.containerInfo,
    containerInfoError: modalState.containerInfoError,
    draftName: modalState.draftName,
    draftShareAccessLevel: modalState.draftShareAccessLevel,
    draftShareGroupId: modalState.draftShareGroupId,
    draftTargetContainerId: modalState.draftTargetContainerId,
    handleContainerInfoPeerShare,
    handleModalSubmit,
    isLoadingContainerInfo: modalState.isLoadingContainerInfo,
    isSubmittingModal: modalState.isSubmittingModal,
    modalError: modalState.modalError,
    modalState: modalState.modalState,
    moveTargetOptions,
    nameInputRef: modalState.nameInputRef,
    openContainerInfoModal: modalState.openContainerInfoModal,
    openCreateChildModal: modalState.openCreateChildModal,
    openDeleteModal: modalState.openDeleteModal,
    openLinkDocumentModal: modalState.openLinkDocumentModal,
    openMoveDocumentModal: modalState.openMoveDocumentModal,
    openMoveModal: modalState.openMoveModal,
    openRenameModal: modalState.openRenameModal,
    openSharePeerModal: modalState.openSharePeerModal,
    setDraftName: modalState.setDraftName,
    setDraftShareAccessLevel: modalState.setDraftShareAccessLevel,
    setDraftShareGroupId: modalState.setDraftShareGroupId,
    setDraftTargetContainerId: modalState.setDraftTargetContainerId,
    setModalError: modalState.setModalError,
    targetSelectRef: modalState.targetSelectRef,
  };
}
