import type { FormEvent, RefObject } from "react";
import type { MoveTargetOption } from "../targetOptions";
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
  targetSelectRef: RefObject<HTMLSelectElement | null>;
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
          ref={targetSelectRef}
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
    <div className="explorer-modal-actions">
      <button type="button" disabled={isSubmittingModal} onClick={closeModal}>
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
  targetSelectRef: RefObject<HTMLSelectElement | null>;
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
            targetSelectRef={targetSelectRef}
          />
          {modalError && (
            <div className="explorer-modal-error">{modalError}</div>
          )}
          <ExplorerModalActions
            closeModal={closeModal}
            draftName={draftName}
            draftTargetContainerId={draftTargetContainerId}
            isSubmittingModal={isSubmittingModal}
            modalState={modalState}
            peerUserId={peerUserId}
          />
        </form>
      </div>
    </div>
  );
}
