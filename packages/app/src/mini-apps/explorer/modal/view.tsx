import type { FormEvent, RefObject } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS } from "../labels";
import type { MoveTargetOption } from "../model/targetOptions";
import { ExplorerTargetSelect } from "./ExplorerTargetSelect";
import {
  getExplorerModalSubmitLabel,
  getExplorerModalTitle,
  isExplorerModalSubmitDisabled,
} from "./labels";
import type { ExplorerModalState } from "./types";

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
  targetSelectRef: RefObject<HTMLButtonElement | null>;
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
    targetSelectRef,
  } = params;

  if (modalState.mode === "purge") {
    return (
      <MiniAppStatus>
        Permanently delete this folder and everything inside it? Documents also
        kept in another folder are removed from here but preserved there. This
        cannot be undone.
      </MiniAppStatus>
    );
  }

  if (modalState.mode === "empty-trash") {
    return (
      <MiniAppStatus>{EXPLORER_LABELS.emptyTrashConfirmBody}</MiniAppStatus>
    );
  }

  if (modalState.mode === "share-peer") {
    return (
      <MiniAppStatus>
        {peerUserId
          ? `Share this container with peer user ${peerUserId}?`
          : "No peer user is available."}
      </MiniAppStatus>
    );
  }

  if (
    modalState.mode === "link-document" ||
    modalState.mode === "move" ||
    modalState.mode === "move-document"
  ) {
    return (
      <div className="mini-app-field">
        <span>Destination</span>
        <ExplorerTargetSelect
          ariaLabel="Destination container"
          disabled={isSubmittingModal}
          onChange={(value) => {
            setModalError(null);
            setDraftTargetContainerId(value);
          }}
          options={moveTargetOptions}
          selectRef={targetSelectRef}
          value={draftTargetContainerId}
        />
      </div>
    );
  }

  return (
    <MiniAppField>
      <span>Name</span>
      <MiniAppInput
        ref={nameInputRef}
        aria-label="Container name"
        disabled={isSubmittingModal}
        value={draftName}
        onChange={(event) => {
          setModalError(null);
          setDraftName(event.target.value);
        }}
      />
    </MiniAppField>
  );
}

function ExplorerModalActions(params: {
  closeModal: () => void;
  draftName: string;
  draftTargetContainerId: string;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState;
  peerUserId: string | null;
}) {
  const {
    closeModal,
    draftName,
    draftTargetContainerId,
    isSubmittingModal,
    modalState,
    peerUserId,
  } = params;

  return (
    <MiniAppActions>
      <MiniAppButton disabled={isSubmittingModal} onClick={closeModal}>
        Cancel
      </MiniAppButton>
      <MiniAppButton
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
      </MiniAppButton>
    </MiniAppActions>
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
  targetSelectRef: RefObject<HTMLButtonElement | null>;
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
    targetSelectRef,
  } = params;

  if (!modalState) {
    return null;
  }

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby="explorer-modal-title"
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleModalSubmit}>
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
            targetSelectRef={targetSelectRef}
          />
          {modalError && (
            <MiniAppStatus tone="error">{modalError}</MiniAppStatus>
          )}
          <ExplorerModalActions
            closeModal={closeModal}
            draftName={draftName}
            draftTargetContainerId={draftTargetContainerId}
            isSubmittingModal={isSubmittingModal}
            modalState={modalState}
            peerUserId={peerUserId}
          />
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
