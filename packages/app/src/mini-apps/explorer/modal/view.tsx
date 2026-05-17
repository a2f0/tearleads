import type { FormEvent, RefObject } from "react";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../../stores/explorer/containerInfo";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import type { MoveTargetOption } from "../targetOptions";
import {
  getExplorerModalSubmitLabel,
  getExplorerModalTitle,
  isExplorerModalSubmitDisabled,
} from "./labels";
import type { ExplorerModalState } from "./types";

function ExplorerModalBody(params: {
  containerInfo: ExplorerContainerInfo | null;
  containerInfoError: string | null;
  draftName: string;
  draftShareAccessLevel: ExplorerContainerShareAccessLevel;
  draftShareGroupId: string;
  draftTargetContainerId: string;
  handleContainerInfoPeerShare: () => void;
  isLoadingContainerInfo: boolean;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState;
  moveTargetOptions: ReadonlyArray<MoveTargetOption>;
  nameInputRef: RefObject<HTMLInputElement | null>;
  peerUserId: string | null;
  setDraftName: (value: string) => void;
  setDraftShareAccessLevel: (value: ExplorerContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  targetSelectRef: RefObject<HTMLSelectElement | null>;
}) {
  const {
    containerInfo,
    containerInfoError,
    draftName,
    draftShareAccessLevel,
    draftShareGroupId,
    draftTargetContainerId,
    handleContainerInfoPeerShare,
    isLoadingContainerInfo,
    isSubmittingModal,
    modalState,
    moveTargetOptions,
    nameInputRef,
    peerUserId,
    setDraftName,
    setDraftShareAccessLevel,
    setDraftShareGroupId,
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

  if (modalState.mode === "container-info") {
    return (
      <ExplorerContainerInfoModalBody
        containerId={modalState.nodeId}
        containerInfo={containerInfo}
        containerInfoError={containerInfoError}
        draftShareAccessLevel={draftShareAccessLevel}
        draftShareGroupId={draftShareGroupId}
        isLoadingContainerInfo={isLoadingContainerInfo}
        isSubmittingModal={isSubmittingModal}
        onShareWithPeer={handleContainerInfoPeerShare}
        peerUserId={peerUserId}
        setDraftShareAccessLevel={setDraftShareAccessLevel}
        setDraftShareGroupId={setDraftShareGroupId}
        setModalError={setModalError}
      />
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

function compactPrincipalId(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function principalLabel(
  subjectType: string,
  subjectId: string,
  containerInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>,
): string {
  if (subjectType === "group") {
    const group = containerInfo.groups.find(
      (candidate) => candidate.groupId === subjectId,
    );
    if (group) {
      return group.name;
    }
  }

  return compactPrincipalId(subjectId);
}

function ExplorerContainerInfoSyncCursorList(params: {
  containerInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>;
}) {
  const { containerInfo } = params;

  return (
    <table className="explorer-info-table">
      <thead>
        <tr>
          <th>Lane</th>
          <th>Cursor</th>
          <th>Saved</th>
        </tr>
      </thead>
      <tbody>
        {containerInfo.syncCursors.map((cursor) => (
          <tr key={`${cursor.laneKind}:${cursor.laneId}`}>
            <td>
              <div>{cursor.label}</div>
              <code title={`${cursor.laneKind}:${cursor.laneId}`}>
                {cursor.laneKind}/{cursor.laneId}
              </code>
            </td>
            <td>
              {cursor.watermarkUpdatedAt ? (
                <>
                  <div title={cursor.watermarkUpdatedAt}>
                    {formatMiniAppDateTime(cursor.watermarkUpdatedAt)}
                  </div>
                  <code title={cursor.watermarkId ?? undefined}>
                    {cursor.watermarkId
                      ? compactPrincipalId(cursor.watermarkId)
                      : ""}
                  </code>
                </>
              ) : (
                <span className="explorer-info-muted">No local cursor</span>
              )}
            </td>
            <td title={cursor.savedAt ?? undefined}>
              {formatMiniAppDateTime(cursor.savedAt, { emptyFallback: "-" })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExplorerContainerInfoGrantList(params: {
  containerInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>;
}) {
  const { containerInfo } = params;
  if (containerInfo.grants.length === 0) {
    return <div className="explorer-modal-copy">No grants.</div>;
  }

  return (
    <table className="explorer-info-table">
      <thead>
        <tr>
          <th>Principal</th>
          <th>Type</th>
          <th>Permission</th>
        </tr>
      </thead>
      <tbody>
        {containerInfo.grants.map((grant) => (
          <tr key={`${grant.subjectType}:${grant.subjectId}`}>
            <td title={grant.subjectId}>
              {principalLabel(
                grant.subjectType,
                grant.subjectId,
                containerInfo,
              )}
            </td>
            <td>{grant.subjectType}</td>
            <td>{grant.accessLevel}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExplorerContainerInfoLocalDetails(params: {
  containerId: string;
  containerInfo: ExplorerContainerInfo | null;
}) {
  const { containerId, containerInfo } = params;

  return (
    <table className="explorer-info-table">
      <tbody>
        <tr>
          <th>ID</th>
          <td title={containerId}>{containerId}</td>
        </tr>
        {containerInfo ? (
          <>
            <tr>
              <th>Created</th>
              <td title={containerInfo.local.createdAt ?? undefined}>
                {formatMiniAppDateTime(containerInfo.local.createdAt, {
                  emptyFallback: "-",
                })}
              </td>
            </tr>
            <tr>
              <th>Updated</th>
              <td title={containerInfo.local.updatedAt ?? undefined}>
                {formatMiniAppDateTime(containerInfo.local.updatedAt, {
                  emptyFallback: "-",
                })}
              </td>
            </tr>
          </>
        ) : null}
      </tbody>
    </table>
  );
}

function ExplorerContainerInfoModalBody(params: {
  containerId: string;
  containerInfo: ExplorerContainerInfo | null;
  containerInfoError: string | null;
  draftShareAccessLevel: ExplorerContainerShareAccessLevel;
  draftShareGroupId: string;
  isLoadingContainerInfo: boolean;
  isSubmittingModal: boolean;
  onShareWithPeer: () => void;
  peerUserId: string | null;
  setDraftShareAccessLevel: (value: ExplorerContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setModalError: (error: string | null) => void;
}) {
  const {
    containerId,
    containerInfo,
    containerInfoError,
    draftShareAccessLevel,
    draftShareGroupId,
    isLoadingContainerInfo,
    isSubmittingModal,
    onShareWithPeer,
    peerUserId,
    setDraftShareAccessLevel,
    setDraftShareGroupId,
    setModalError,
  } = params;
  const shareableGroups =
    containerInfo?.remoteInfo?.groups.filter((group) => group.currentState) ??
    [];
  const localDetails = (
    <section className="explorer-info-section">
      <h3>Local Details</h3>
      <ExplorerContainerInfoLocalDetails
        containerId={containerId}
        containerInfo={containerInfo}
      />
    </section>
  );

  if (isLoadingContainerInfo && !containerInfo) {
    return (
      <div className="explorer-info">
        {localDetails}
        <div className="explorer-modal-copy">Loading...</div>
      </div>
    );
  }

  if (containerInfoError) {
    return (
      <div className="explorer-info">
        {localDetails}
        <div className="explorer-modal-error">{containerInfoError}</div>
      </div>
    );
  }

  if (!containerInfo) {
    return <div className="explorer-info">{localDetails}</div>;
  }

  return (
    <div className="explorer-info">
      {localDetails}
      {containerInfo.remoteInfo ? (
        <>
          <section className="explorer-info-section">
            <h3>Principal Grants</h3>
            <ExplorerContainerInfoGrantList
              containerInfo={containerInfo.remoteInfo}
            />
          </section>
          <section className="explorer-info-section">
            <h3>Sync Cursors</h3>
            <ExplorerContainerInfoSyncCursorList
              containerInfo={containerInfo.remoteInfo}
            />
          </section>
          <section className="explorer-info-section">
            <h3>Share To Group</h3>
            <label className="explorer-modal-field">
              Group
              <select
                aria-label="Group"
                disabled={isSubmittingModal || shareableGroups.length === 0}
                value={draftShareGroupId}
                onChange={(event) => {
                  setModalError(null);
                  setDraftShareGroupId(event.target.value);
                }}
              >
                {shareableGroups.length === 0 ? (
                  <option value="">No groups</option>
                ) : (
                  shareableGroups.map((group) => (
                    <option key={group.groupId} value={group.groupId}>
                      {group.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="explorer-modal-field">
              Permission
              <select
                aria-label="Permission"
                disabled={isSubmittingModal || shareableGroups.length === 0}
                value={draftShareAccessLevel}
                onChange={(event) => {
                  setModalError(null);
                  setDraftShareAccessLevel(
                    event.target.value as ExplorerContainerShareAccessLevel,
                  );
                }}
              >
                <option value="read">read</option>
                <option value="write">write</option>
                <option value="admin">admin</option>
              </select>
            </label>
          </section>
          {peerUserId ? (
            <section className="explorer-info-section">
              <h3>Share To Peer</h3>
              <button
                className="explorer-info-inline-action"
                disabled={isSubmittingModal}
                type="button"
                onClick={onShareWithPeer}
              >
                Share With Peer
              </button>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ExplorerModalActions(params: {
  closeModal: () => void;
  containerInfo: ExplorerContainerInfo | null;
  draftName: string;
  draftShareGroupId: string;
  draftTargetContainerId: string;
  isLoadingContainerInfo: boolean;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState;
  peerUserId: string | null;
}) {
  const {
    closeModal,
    containerInfo,
    draftName,
    draftShareGroupId,
    draftTargetContainerId,
    isLoadingContainerInfo,
    isSubmittingModal,
    modalState,
    peerUserId,
  } = params;
  const showSubmitButton =
    modalState.mode !== "container-info" ||
    isLoadingContainerInfo ||
    Boolean(containerInfo?.remoteInfo);

  return (
    <div className="explorer-modal-actions">
      <button type="button" disabled={isSubmittingModal} onClick={closeModal}>
        {modalState.mode === "container-info" && !showSubmitButton
          ? "Close"
          : "Cancel"}
      </button>
      {showSubmitButton ? (
        <button
          type="submit"
          disabled={isExplorerModalSubmitDisabled({
            draftName,
            draftShareGroupId,
            draftTargetContainerId,
            isLoadingContainerInfo,
            isSubmittingModal,
            modalState,
            peerUserId,
          })}
        >
          {getExplorerModalSubmitLabel(modalState, isSubmittingModal)}
        </button>
      ) : null}
    </div>
  );
}

export function ExplorerModalLayer(params: {
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
  peerUserId: string | null;
  setDraftName: (value: string) => void;
  setDraftShareAccessLevel: (value: ExplorerContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setDraftTargetContainerId: (value: string) => void;
  setModalError: (error: string | null) => void;
  targetSelectRef: RefObject<HTMLSelectElement | null>;
}) {
  const {
    closeModal,
    containerInfo,
    containerInfoError,
    draftName,
    draftShareAccessLevel,
    draftShareGroupId,
    draftTargetContainerId,
    handleContainerInfoPeerShare,
    handleModalSubmit,
    isLoadingContainerInfo,
    isSubmittingModal,
    modalError,
    modalState,
    moveTargetOptions,
    nameInputRef,
    peerUserId,
    setDraftName,
    setDraftShareAccessLevel,
    setDraftShareGroupId,
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
        className={`explorer-modal${
          modalState.mode === "container-info" ? " explorer-modal--info" : ""
        }`}
        role="dialog"
        aria-labelledby="explorer-modal-title"
        aria-modal="true"
      >
        <form className="explorer-modal-form" onSubmit={handleModalSubmit}>
          <h2 id="explorer-modal-title">{getExplorerModalTitle(modalState)}</h2>
          <ExplorerModalBody
            containerInfo={containerInfo}
            containerInfoError={containerInfoError}
            draftName={draftName}
            draftShareAccessLevel={draftShareAccessLevel}
            draftShareGroupId={draftShareGroupId}
            draftTargetContainerId={draftTargetContainerId}
            handleContainerInfoPeerShare={handleContainerInfoPeerShare}
            isLoadingContainerInfo={isLoadingContainerInfo}
            isSubmittingModal={isSubmittingModal}
            modalState={modalState}
            moveTargetOptions={moveTargetOptions}
            nameInputRef={nameInputRef}
            peerUserId={peerUserId}
            setDraftName={setDraftName}
            setDraftShareAccessLevel={setDraftShareAccessLevel}
            setDraftShareGroupId={setDraftShareGroupId}
            setDraftTargetContainerId={setDraftTargetContainerId}
            setModalError={setModalError}
            targetSelectRef={targetSelectRef}
          />
          {modalError && (
            <div className="explorer-modal-error">{modalError}</div>
          )}
          <ExplorerModalActions
            closeModal={closeModal}
            containerInfo={containerInfo}
            draftName={draftName}
            draftShareGroupId={draftShareGroupId}
            draftTargetContainerId={draftTargetContainerId}
            isLoadingContainerInfo={isLoadingContainerInfo}
            isSubmittingModal={isSubmittingModal}
            modalState={modalState}
            peerUserId={peerUserId}
          />
        </form>
      </div>
    </div>
  );
}
