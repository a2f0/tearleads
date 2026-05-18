import type { KeyboardEvent, MouseEvent } from "react";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../../stores/explorer/containerInfo";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import type { MiniAppWindowPosition } from "../../bus";
import { EXPLORER_LABELS } from "../labels";

type ExplorerContainerInfoGrantSubjectType = NonNullable<
  ExplorerContainerInfo["remoteInfo"]
>["grants"][number]["subjectType"];

const CONTAINER_INFO_PERMISSION_LABELS = {
  admin: EXPLORER_LABELS.containerInfoPermissionAdmin,
  read: EXPLORER_LABELS.containerInfoPermissionRead,
  write: EXPLORER_LABELS.containerInfoPermissionWrite,
} satisfies Record<ExplorerContainerShareAccessLevel, string>;

const CONTAINER_INFO_SUBJECT_TYPE_LABELS = {
  group: EXPLORER_LABELS.containerInfoSubjectTypeGroup,
  organization: EXPLORER_LABELS.containerInfoSubjectTypeOrganization,
  user: EXPLORER_LABELS.containerInfoSubjectTypeUser,
} satisfies Record<ExplorerContainerInfoGrantSubjectType, string>;

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

function getContainerInfoPermissionLabel(
  accessLevel: ExplorerContainerShareAccessLevel,
): string {
  return CONTAINER_INFO_PERMISSION_LABELS[accessLevel];
}

function getContainerInfoSubjectTypeLabel(
  subjectType: ExplorerContainerInfoGrantSubjectType,
): string {
  return CONTAINER_INFO_SUBJECT_TYPE_LABELS[subjectType];
}

function isKeyboardActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

function getKeyboardEventPosition(
  event: KeyboardEvent<HTMLTableRowElement>,
): MiniAppWindowPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: rect.left + 16,
    y: rect.top + 16,
  };
}

function getMouseEventPosition(
  event: MouseEvent<HTMLTableRowElement>,
): MiniAppWindowPosition {
  return {
    x: event.clientX + 16,
    y: event.clientY + 16,
  };
}

function ExplorerContainerInfoSyncCursorList(params: {
  containerInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>;
}) {
  const { containerInfo } = params;

  return (
    <table className="explorer-info-table">
      <thead>
        <tr>
          <th>{EXPLORER_LABELS.containerInfoLaneColumn}</th>
          <th>{EXPLORER_LABELS.containerInfoCursorColumn}</th>
          <th>{EXPLORER_LABELS.containerInfoSavedColumn}</th>
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
                <span className="explorer-info-muted">
                  {EXPLORER_LABELS.containerInfoNoLocalCursor}
                </span>
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
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
}) {
  const { containerInfo, onOpenGrantGroup } = params;
  if (containerInfo.grants.length === 0) {
    return (
      <div className="explorer-modal-copy">
        {EXPLORER_LABELS.containerInfoNoGrants}
      </div>
    );
  }

  return (
    <table className="explorer-info-table">
      <thead>
        <tr>
          <th>{EXPLORER_LABELS.containerInfoPrincipalColumn}</th>
          <th>{EXPLORER_LABELS.containerInfoTypeColumn}</th>
          <th>{EXPLORER_LABELS.containerInfoPermissionColumn}</th>
        </tr>
      </thead>
      <tbody>
        {containerInfo.grants.map((grant) => {
          const isGroupGrant = grant.subjectType === "group";
          const openGrantGroupRoute = (position?: MiniAppWindowPosition) => {
            onOpenGrantGroup(grant.subjectId, position);
          };
          const handleGrantRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (!isKeyboardActivationKey(event.key)) {
              return;
            }

            event.preventDefault();
            openGrantGroupRoute(getKeyboardEventPosition(event));
          };

          return (
            <tr
              className={
                isGroupGrant
                  ? "explorer-info-grant-row--interactive"
                  : undefined
              }
              key={`${grant.subjectType}:${grant.subjectId}`}
              onClick={
                isGroupGrant
                  ? (event) => openGrantGroupRoute(getMouseEventPosition(event))
                  : undefined
              }
              onKeyDown={isGroupGrant ? handleGrantRowKeyDown : undefined}
              tabIndex={isGroupGrant ? 0 : undefined}
            >
              <td title={grant.subjectId}>
                {principalLabel(
                  grant.subjectType,
                  grant.subjectId,
                  containerInfo,
                )}
              </td>
              <td>{getContainerInfoSubjectTypeLabel(grant.subjectType)}</td>
              <td>{getContainerInfoPermissionLabel(grant.accessLevel)}</td>
            </tr>
          );
        })}
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
          <th>{EXPLORER_LABELS.containerInfoIdRow}</th>
          <td title={containerId}>{containerId}</td>
        </tr>
        {containerInfo ? (
          <>
            <tr>
              <th>{EXPLORER_LABELS.containerInfoCreatedRow}</th>
              <td title={containerInfo.local.createdAt ?? undefined}>
                {formatMiniAppDateTime(containerInfo.local.createdAt, {
                  emptyFallback: "-",
                })}
              </td>
            </tr>
            <tr>
              <th>{EXPLORER_LABELS.containerInfoUpdatedRow}</th>
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

function ExplorerContainerInfoLocalSection(params: {
  containerId: string;
  containerInfo: ExplorerContainerInfo | null;
}) {
  const { containerId, containerInfo } = params;

  return (
    <section className="explorer-info-section">
      <h3>{EXPLORER_LABELS.containerInfoLocalDetailsHeading}</h3>
      <ExplorerContainerInfoLocalDetails
        containerId={containerId}
        containerInfo={containerInfo}
      />
    </section>
  );
}

function ExplorerContainerInfoGroupShareSection(params: {
  draftShareAccessLevel: ExplorerContainerShareAccessLevel;
  draftShareGroupId: string;
  isSubmitting: boolean;
  remoteInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>;
  setDraftShareAccessLevel: (value: ExplorerContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setPanelError: (error: string | null) => void;
}) {
  const {
    draftShareAccessLevel,
    draftShareGroupId,
    isSubmitting,
    remoteInfo,
    setDraftShareAccessLevel,
    setDraftShareGroupId,
    setPanelError,
  } = params;
  const shareableGroups = remoteInfo.groups.filter(
    (group) => group.currentState,
  );

  return (
    <section className="explorer-info-section">
      <h3>{EXPLORER_LABELS.containerInfoShareToGroupHeading}</h3>
      <label className="explorer-modal-field">
        {EXPLORER_LABELS.containerInfoGroupField}
        <select
          aria-label={EXPLORER_LABELS.containerInfoGroupField}
          disabled={isSubmitting || shareableGroups.length === 0}
          value={draftShareGroupId}
          onChange={(event) => {
            setPanelError(null);
            setDraftShareGroupId(event.target.value);
          }}
        >
          {shareableGroups.length === 0 ? (
            <option value="">
              {EXPLORER_LABELS.containerInfoNoGroupsOption}
            </option>
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
        {EXPLORER_LABELS.containerInfoPermissionField}
        <select
          aria-label={EXPLORER_LABELS.containerInfoPermissionField}
          disabled={isSubmitting || shareableGroups.length === 0}
          value={draftShareAccessLevel}
          onChange={(event) => {
            setPanelError(null);
            setDraftShareAccessLevel(
              event.target.value as ExplorerContainerShareAccessLevel,
            );
          }}
        >
          <option value="read">
            {getContainerInfoPermissionLabel("read")}
          </option>
          <option value="write">
            {getContainerInfoPermissionLabel("write")}
          </option>
          <option value="admin">
            {getContainerInfoPermissionLabel("admin")}
          </option>
        </select>
      </label>
    </section>
  );
}

function ExplorerContainerInfoPeerShareSection(params: {
  isSubmitting: boolean;
  onShareWithPeer: () => void;
}) {
  const { isSubmitting, onShareWithPeer } = params;

  return (
    <section className="explorer-info-section">
      <h3>{EXPLORER_LABELS.containerInfoShareToPeerHeading}</h3>
      <button
        className="explorer-info-inline-action"
        disabled={isSubmitting}
        type="button"
        onClick={onShareWithPeer}
      >
        {EXPLORER_LABELS.containerInfoShareToPeerAction}
      </button>
    </section>
  );
}

function ExplorerContainerInfoRemoteSections(params: {
  draftShareAccessLevel: ExplorerContainerShareAccessLevel;
  draftShareGroupId: string;
  isSubmitting: boolean;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
  onShareWithPeer: () => void;
  peerUserId: string | null;
  remoteInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>;
  setDraftShareAccessLevel: (value: ExplorerContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setPanelError: (error: string | null) => void;
}) {
  const { peerUserId, remoteInfo } = params;

  return (
    <>
      <section className="explorer-info-section">
        <h3>{EXPLORER_LABELS.containerInfoPrincipalGrantsHeading}</h3>
        <ExplorerContainerInfoGrantList
          containerInfo={remoteInfo}
          onOpenGrantGroup={params.onOpenGrantGroup}
        />
      </section>
      <section className="explorer-info-section">
        <h3>{EXPLORER_LABELS.containerInfoSyncCursorsHeading}</h3>
        <ExplorerContainerInfoSyncCursorList containerInfo={remoteInfo} />
      </section>
      <ExplorerContainerInfoGroupShareSection {...params} />
      {peerUserId ? (
        <ExplorerContainerInfoPeerShareSection {...params} />
      ) : null}
    </>
  );
}

export function ExplorerContainerInfoBody(params: {
  containerId: string;
  containerInfo: ExplorerContainerInfo | null;
  containerInfoError: string | null;
  draftShareAccessLevel: ExplorerContainerShareAccessLevel;
  draftShareGroupId: string;
  isLoadingContainerInfo: boolean;
  isSubmitting: boolean;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
  onShareWithPeer: () => void;
  peerUserId: string | null;
  setDraftShareAccessLevel: (value: ExplorerContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setPanelError: (error: string | null) => void;
}) {
  const { containerId, containerInfo, containerInfoError } = params;
  const localSection = (
    <ExplorerContainerInfoLocalSection
      containerId={containerId}
      containerInfo={containerInfo}
    />
  );

  if (params.isLoadingContainerInfo && !containerInfo) {
    return (
      <div className="explorer-info">
        {localSection}
        <div className="explorer-modal-copy">
          {EXPLORER_LABELS.containerInfoLoading}
        </div>
      </div>
    );
  }

  if (containerInfoError) {
    return (
      <div className="explorer-info">
        {localSection}
        <div className="explorer-modal-error">{containerInfoError}</div>
      </div>
    );
  }

  if (!containerInfo) {
    return <div className="explorer-info">{localSection}</div>;
  }

  return (
    <div className="explorer-info">
      {localSection}
      {containerInfo.remoteInfo ? (
        <ExplorerContainerInfoRemoteSections
          {...params}
          remoteInfo={containerInfo.remoteInfo}
        />
      ) : null}
    </div>
  );
}

export function ExplorerContainerInfoHeader(params: {
  containerId: string;
  containerName: string | undefined;
  isSubmitting: boolean;
  onBackToContainer: () => void;
}) {
  const { containerId, containerName, isSubmitting, onBackToContainer } =
    params;
  return (
    <div className="explorer-detail-header">
      <div className="explorer-detail-copy">
        <strong>{EXPLORER_LABELS.containerInfoTitle}</strong>
        <span>{containerName ?? compactPrincipalId(containerId)}</span>
      </div>
      <div className="explorer-detail-actions">
        <button
          type="button"
          className="explorer-action-button"
          disabled={isSubmitting}
          onClick={onBackToContainer}
        >
          {EXPLORER_LABELS.backToContainerAction}
        </button>
      </div>
    </div>
  );
}

export function ExplorerContainerInfoActions(params: {
  draftShareGroupId: string;
  isLoadingContainerInfo: boolean;
  isSubmitting: boolean;
  showShareButton: boolean;
}) {
  const {
    draftShareGroupId,
    isLoadingContainerInfo,
    isSubmitting,
    showShareButton,
  } = params;
  if (!showShareButton) {
    return null;
  }

  return (
    <div className="explorer-modal-actions">
      <button
        type="submit"
        disabled={isSubmitting || isLoadingContainerInfo || !draftShareGroupId}
      >
        {isSubmitting
          ? EXPLORER_LABELS.containerInfoSharingAction
          : EXPLORER_LABELS.containerInfoShareAction}
      </button>
    </div>
  );
}
