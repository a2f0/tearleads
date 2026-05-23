import type { KeyboardEvent, MouseEvent } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppSelect,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../../stores/explorer/containerInfo";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import type { MiniAppWindowPosition } from "../../bus";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoEventLabel,
  getExplorerContainerInfoGrantSummaryLabel,
  getExplorerContainerInfoInheritedGrantSource,
  getExplorerContainerInfoManifestHistoryLabel,
  getExplorerContainerInfoPathSummaryLabel,
  getExplorerContainerInfoRecipientSummaryLabel,
} from "../labels";

type ExplorerContainerInfoGrantSubjectType = NonNullable<
  ExplorerContainerInfo["remoteInfo"]
>["grants"][number]["subjectType"];

type ExplorerContainerInfoGrantRow = NonNullable<
  ExplorerContainerInfo["remoteInfo"]
>["grantRows"][number];

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

const GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET = 16;

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

function sourceContainerLabel(
  sourceContainerId: string,
  containerNamesById: ReadonlyMap<string, string>,
): string {
  return (
    containerNamesById.get(sourceContainerId) ??
    compactPrincipalId(sourceContainerId)
  );
}

function grantSourceLabel(
  grant: ExplorerContainerInfoGrantRow,
  containerNamesById: ReadonlyMap<string, string>,
): string {
  if (!grant.inherited) {
    return EXPLORER_LABELS.containerInfoSourceDirect;
  }

  return getExplorerContainerInfoInheritedGrantSource(
    sourceContainerLabel(grant.sourceContainerId, containerNamesById),
  );
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
    x: rect.left + GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET,
    y: rect.top + GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET,
  };
}

function getMouseEventPosition(
  event: MouseEvent<HTMLTableRowElement>,
): MiniAppWindowPosition {
  return {
    x: event.clientX + GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET,
    y: event.clientY + GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET,
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
                <MiniAppStatus as="span" className="explorer-info-muted">
                  {EXPLORER_LABELS.containerInfoNoLocalCursor}
                </MiniAppStatus>
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
  containerNamesById: ReadonlyMap<string, string>;
  containerInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
}) {
  const { containerInfo, containerNamesById, onOpenGrantGroup } = params;
  if (containerInfo.grantRows.length === 0) {
    return (
      <MiniAppStatus>{EXPLORER_LABELS.containerInfoNoGrants}</MiniAppStatus>
    );
  }

  return (
    <table className="explorer-info-table">
      <thead>
        <tr>
          <th>{EXPLORER_LABELS.containerInfoPrincipalColumn}</th>
          <th>{EXPLORER_LABELS.containerInfoTypeColumn}</th>
          <th>{EXPLORER_LABELS.containerInfoPermissionColumn}</th>
          <th>{EXPLORER_LABELS.containerInfoSourceColumn}</th>
        </tr>
      </thead>
      <tbody>
        {containerInfo.grantRows.map((grant) => {
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
              key={`${grant.sourceContainerId}:${grant.subjectType}:${grant.subjectId}`}
              onClick={
                isGroupGrant
                  ? (event) => openGrantGroupRoute(getMouseEventPosition(event))
                  : undefined
              }
              onKeyDown={isGroupGrant ? handleGrantRowKeyDown : undefined}
              role={isGroupGrant ? "button" : undefined}
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
              <td title={grant.sourceContainerId}>
                {grantSourceLabel(grant, containerNamesById)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ExplorerContainerInfoSecuritySection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  remoteInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>;
}) {
  const { containerNamesById, remoteInfo } = params;
  const security = remoteInfo.security;
  if (!security) {
    return null;
  }

  return (
    <section className="explorer-info-section">
      <h3>{EXPLORER_LABELS.containerInfoSecurityHeading}</h3>
      <table className="explorer-info-table">
        <tbody>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoSecurityManifestHashRow}</th>
            <td title={security.currentManifestHash}>
              {compactPrincipalId(security.currentManifestHash)}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoSecurityKeyEpochRow}</th>
            <td title={security.currentContainerKeyEpochId}>
              {security.currentContainerKeyEpoch} /{" "}
              {compactPrincipalId(security.currentContainerKeyEpochId)}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoSecurityParentKeyEpochRow}</th>
            <td title={security.currentParentContainerKeyEpochId ?? undefined}>
              {security.currentParentContainerKeyEpochId
                ? compactPrincipalId(security.currentParentContainerKeyEpochId)
                : "-"}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoManifestHistoryRow}</th>
            <td>
              {getExplorerContainerInfoManifestHistoryLabel(
                security.currentManifestHistoryCount,
              )}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoPathRow}</th>
            <td>
              {getExplorerContainerInfoPathSummaryLabel({
                pathLength: security.pathLength,
                referencedPrincipalCount:
                  security.currentReferencedPrincipalCount,
              })}
            </td>
          </tr>
        </tbody>
      </table>
      <h3>{EXPLORER_LABELS.containerInfoPathHeading}</h3>
      <table className="explorer-info-table">
        <thead>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoPathColumn}</th>
            <th>{EXPLORER_LABELS.containerInfoManifestColumn}</th>
            <th>{EXPLORER_LABELS.containerInfoSecurityKeyEpochRow}</th>
            <th>{EXPLORER_LABELS.containerInfoRecipientsColumn}</th>
          </tr>
        </thead>
        <tbody>
          {security.path.map((entry) => (
            <tr key={`${entry.containerId}:${entry.manifestHash}`}>
              <td title={entry.containerId}>
                {containerNamesById.get(entry.containerId) ??
                  compactPrincipalId(entry.containerId)}
              </td>
              <td title={entry.manifestHash}>
                <div>{compactPrincipalId(entry.manifestHash)}</div>
                <code title={entry.eventHash}>
                  {getExplorerContainerInfoEventLabel(
                    compactPrincipalId(entry.eventHash),
                  )}
                </code>
              </td>
              <td title={entry.containerKeyEpochId}>
                <div>{entry.containerKeyEpoch}</div>
                <code>{compactPrincipalId(entry.containerKeyEpochId)}</code>
              </td>
              <td>
                {getExplorerContainerInfoRecipientSummaryLabel({
                  recipientTargetCount: entry.recipientTargetCount,
                  wrapCount: entry.wrapCount,
                })}
                <br />
                {getExplorerContainerInfoGrantSummaryLabel({
                  directGrantCount: entry.directGrantCount,
                  referencedPrincipalCount: entry.referencedPrincipalCount,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
      <MiniAppField>
        <span>{EXPLORER_LABELS.containerInfoGroupField}</span>
        <MiniAppSelect
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
        </MiniAppSelect>
      </MiniAppField>
      <MiniAppField>
        <span>{EXPLORER_LABELS.containerInfoPermissionField}</span>
        <MiniAppSelect
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
        </MiniAppSelect>
      </MiniAppField>
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
      <MiniAppButton
        className="explorer-info-inline-action"
        disabled={isSubmitting}
        onClick={onShareWithPeer}
      >
        {EXPLORER_LABELS.containerInfoShareToPeerAction}
      </MiniAppButton>
    </section>
  );
}

function ExplorerContainerInfoRemoteSections(params: {
  containerNamesById: ReadonlyMap<string, string>;
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
          containerNamesById={params.containerNamesById}
          containerInfo={remoteInfo}
          onOpenGrantGroup={params.onOpenGrantGroup}
        />
      </section>
      <ExplorerContainerInfoSecuritySection
        containerNamesById={params.containerNamesById}
        remoteInfo={remoteInfo}
      />
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
  containerNamesById: ReadonlyMap<string, string>;
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
        <MiniAppStatus>{EXPLORER_LABELS.containerInfoLoading}</MiniAppStatus>
      </div>
    );
  }

  if (containerInfoError) {
    return (
      <div className="explorer-info">
        {localSection}
        <MiniAppStatus tone="error">{containerInfoError}</MiniAppStatus>
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
      <MiniAppActions>
        <MiniAppButton disabled={isSubmitting} onClick={onBackToContainer}>
          {EXPLORER_LABELS.backToContainerAction}
        </MiniAppButton>
      </MiniAppActions>
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
    <MiniAppActions>
      <MiniAppButton
        type="submit"
        disabled={isSubmitting || isLoadingContainerInfo || !draftShareGroupId}
      >
        {isSubmitting
          ? EXPLORER_LABELS.containerInfoSharingAction
          : EXPLORER_LABELS.containerInfoShareAction}
      </MiniAppButton>
    </MiniAppActions>
  );
}
