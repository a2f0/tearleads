import type { ContainerNode, DocumentSummary } from "@symcrypt/client-sdk";
import type { FormEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExplorerContainerRulesContext } from "../model/containerRules";
import {
  createExplorerTargetLookups,
  getDocumentLinkedContainerIds,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
  getMoveTargetOptions,
} from "../model/targetOptions";
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

function useExplorerModalEffects(params: {
  closeModal: () => void;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState | null;
  nameInputRef: RefObject<HTMLInputElement | null>;
  targetSelectRef: RefObject<HTMLButtonElement | null>;
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

function useExplorerModalState(
  canShareWithPeer: boolean,
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>,
  rulesContext: ExplorerContainerRulesContext,
) {
  const [modalState, setModalState] = useState<ExplorerModalState | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [backgroundActionError, setBackgroundActionError] = useState<
    string | null
  >(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTargetContainerId, setDraftTargetContainerId] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const targetSelectRef = useRef<HTMLButtonElement>(null);
  const targetLookups = useMemo(
    () => createExplorerTargetLookups(nodes, documentSummaries),
    [documentSummaries, nodes],
  );
  const clearModal = useCallback(() => {
    clearExplorerModalState(
      setModalState,
      setModalError,
      setDraftName,
      setDraftTargetContainerId,
    );
  }, []);

  const closeModal = useCallback(() => {
    if (!isSubmittingModal) {
      clearModal();
    }
  }, [clearModal, isSubmittingModal]);
  const openers = useExplorerModalOpeners({
    canShareWithPeer,
    linkedContainerIdsByDocumentId,
    nodes,
    rulesContext,
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

  return {
    ...openers,
    backgroundActionError,
    clearModal,
    closeModal,
    draftName,
    draftTargetContainerId,
    isSubmittingModal,
    modalError,
    modalState,
    nameInputRef,
    targetLookups,
    targetSelectRef,
    setDraftName,
    setDraftTargetContainerId,
    setBackgroundActionError,
    setIsSubmittingModal,
    setModalError,
  };
}

interface ExplorerModalSubmitControllerParams
  extends ExplorerModalSubmitParams {
  isSubmittingModal: boolean;
  setIsSubmittingModal: (value: boolean) => void;
  setBackgroundActionError: (error: string | null) => void;
}

function useExplorerModalSubmit(params: ExplorerModalSubmitControllerParams) {
  const {
    isSubmittingModal,
    modalState,
    setBackgroundActionError,
    setIsSubmittingModal,
    setModalError,
  } = params;

  return useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!modalState || isSubmittingModal) {
        return;
      }

      setModalError(null);
      setBackgroundActionError(null);
      setIsSubmittingModal(true);

      try {
        // The controller params are a structural superset of the submit params,
        // so the dispatcher takes them as-is.
        await submitExplorerModalAction(params);
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
      params,
      setBackgroundActionError,
      setIsSubmittingModal,
      setModalError,
    ],
  );
}

export function useExplorerModalController(
  params: ExplorerModalControllerParams,
): ExplorerModalController {
  const modalState = useExplorerModalState(
    params.canShareWithPeer,
    params.nodes,
    params.documentSummaries,
    params.linkedContainerIdsByDocumentId,
    params.rulesContext,
  );
  const moveTargetOptions = useMemo(() => {
    if (modalState.modalState?.mode === "move") {
      return getMoveTargetOptions(
        params.nodes,
        modalState.modalState.nodeId,
        modalState.targetLookups,
        params.rulesContext,
      );
    }

    if (modalState.modalState?.mode === "link-document") {
      const { documentLocalId } = modalState.modalState;
      return getDocumentLinkTargetOptions(
        params.nodes,
        documentLocalId,
        getDocumentLinkedContainerIds({
          document:
            modalState.targetLookups.documentSummariesById.get(documentLocalId),
          linkedContainerIdsByDocumentId: params.linkedContainerIdsByDocumentId,
        }),
        modalState.targetLookups,
        params.rulesContext,
      );
    }

    if (modalState.modalState?.mode === "move-document") {
      return getDocumentMoveTargetOptions(
        params.nodes,
        modalState.modalState.documentLocalId,
        modalState.targetLookups,
        params.rulesContext,
        params.linkedContainerIdsByDocumentId,
      );
    }

    return [];
  }, [
    modalState.modalState,
    modalState.targetLookups,
    params.linkedContainerIdsByDocumentId,
    params.nodes,
    params.rulesContext,
  ]);
  const handleModalSubmit = useExplorerModalSubmit({
    ...params,
    clearModal: modalState.clearModal,
    draftName: modalState.draftName,
    draftTargetContainerId: modalState.draftTargetContainerId,
    isSubmittingModal: modalState.isSubmittingModal,
    modalState: modalState.modalState,
    setBackgroundActionError: modalState.setBackgroundActionError,
    setIsSubmittingModal: modalState.setIsSubmittingModal,
    setModalError: modalState.setModalError,
  });

  return {
    ...modalState,
    handleModalSubmit,
    moveTargetOptions,
  };
}
