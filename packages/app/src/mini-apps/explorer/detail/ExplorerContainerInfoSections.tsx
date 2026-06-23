import type {
  ContainerInfo,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInfoHeading,
  MiniAppInfoSection,
  MiniAppSelect,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import {
  MiniAppInfoTable,
  MiniAppInfoTableRow,
} from "../../../components/shared/MiniAppTable";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoEventLabel,
  getExplorerContainerInfoGrantSummaryLabel,
  getExplorerContainerInfoInheritedGrantSource,
  getExplorerContainerInfoManifestHistoryLabel,
  getExplorerContainerInfoPathSummaryLabel,
  getExplorerContainerInfoRecipientSummaryLabel,
} from "../labels";
import type { MiniAppWindowPosition } from "../types";
import { compactId } from "./compactId";
import { getContainerInfoShareableGroups } from "./ExplorerContainerInfoState";

type ExplorerContainerInfoGrantSubjectType = NonNullable<
  ContainerInfo["remoteInfo"]
>["grants"][number]["subjectType"];

type ExplorerContainerInfoGrantRow = NonNullable<
  ContainerInfo["remoteInfo"]
>["grantRows"][number];

const CONTAINER_INFO_PERMISSION_LABELS = {
  admin: EXPLORER_LABELS.containerInfoPermissionAdmin,
  read: EXPLORER_LABELS.containerInfoPermissionRead,
  write: EXPLORER_LABELS.containerInfoPermissionWrite,
} satisfies Record<ContainerShareAccessLevel, string>;

const CONTAINER_INFO_SUBJECT_TYPE_LABELS = {
  group: EXPLORER_LABELS.containerInfoSubjectTypeGroup,
  organization: EXPLORER_LABELS.containerInfoSubjectTypeOrganization,
  user: EXPLORER_LABELS.containerInfoSubjectTypeUser,
} satisfies Record<ExplorerContainerInfoGrantSubjectType, string>;

const GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET = 16;

function isContainerShareAccessLevel(
  value: string,
): value is ContainerShareAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

function principalLabel(
  subjectType: string,
  subjectId: string,
  containerInfo: NonNullable<ContainerInfo["remoteInfo"]>,
): string {
  if (subjectType === "group") {
    const group = containerInfo.groups.find(
      (candidate) => candidate.groupId === subjectId,
    );
    if (group) {
      return group.name;
    }
  }

  return compactId(subjectId);
}

function sourceContainerLabel(
  sourceContainerId: string,
  containerNamesById: ReadonlyMap<string, string>,
): string {
  return (
    containerNamesById.get(sourceContainerId) ?? compactId(sourceContainerId)
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
  accessLevel: ContainerShareAccessLevel,
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
  containerInfo: NonNullable<ContainerInfo["remoteInfo"]>;
}) {
  const { containerInfo } = params;

  return (
    <MiniAppInfoTable>
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
                    {cursor.watermarkId ? compactId(cursor.watermarkId) : ""}
                  </code>
                </>
              ) : (
                <MiniAppStatus as="span">
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
    </MiniAppInfoTable>
  );
}

function ExplorerContainerInfoGrantList(params: {
  containerNamesById: ReadonlyMap<string, string>;
  containerInfo: NonNullable<ContainerInfo["remoteInfo"]>;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
}) {
  const { containerInfo, containerNamesById, onOpenGrantGroup } = params;
  if (containerInfo.grantRows.length === 0) {
    return (
      <MiniAppStatus>{EXPLORER_LABELS.containerInfoNoGrants}</MiniAppStatus>
    );
  }

  return (
    <MiniAppInfoTable>
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
            <MiniAppInfoTableRow
              interactive={isGroupGrant}
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
            </MiniAppInfoTableRow>
          );
        })}
      </tbody>
    </MiniAppInfoTable>
  );
}

export function ExplorerContainerInfoSecuritySection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>;
}) {
  const { containerNamesById, remoteInfo } = params;
  const security = remoteInfo.security;
  if (!security) {
    return null;
  }

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.containerInfoSecurityHeading}>
      <MiniAppInfoTable>
        <tbody>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoSecurityManifestHashRow}</th>
            <td title={security.currentManifestHash}>
              {compactId(security.currentManifestHash)}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoSecurityKeyEpochRow}</th>
            <td title={security.currentContainerKeyEpochId}>
              {security.currentContainerKeyEpoch} /{" "}
              {compactId(security.currentContainerKeyEpochId)}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoSecurityParentKeyEpochRow}</th>
            <td title={security.currentParentContainerKeyEpochId ?? undefined}>
              {security.currentParentContainerKeyEpochId
                ? compactId(security.currentParentContainerKeyEpochId)
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
      </MiniAppInfoTable>
      <MiniAppInfoHeading>
        {EXPLORER_LABELS.containerInfoPathHeading}
      </MiniAppInfoHeading>
      <MiniAppInfoTable>
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
                  compactId(entry.containerId)}
              </td>
              <td title={entry.manifestHash}>
                <div>{compactId(entry.manifestHash)}</div>
                <code title={entry.eventHash}>
                  {getExplorerContainerInfoEventLabel(
                    compactId(entry.eventHash),
                  )}
                </code>
              </td>
              <td title={entry.containerKeyEpochId}>
                <div>{entry.containerKeyEpoch}</div>
                <code>{compactId(entry.containerKeyEpochId)}</code>
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
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}

function ExplorerContainerInfoLocalDetails(params: {
  containerId: string;
  containerInfo: ContainerInfo | null;
}) {
  const { containerId, containerInfo } = params;

  return (
    <MiniAppInfoTable>
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
    </MiniAppInfoTable>
  );
}

export function ExplorerContainerInfoLocalSection(params: {
  containerId: string;
  containerInfo: ContainerInfo | null;
}) {
  const { containerId, containerInfo } = params;

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoLocalDetailsHeading}
    >
      <ExplorerContainerInfoLocalDetails
        containerId={containerId}
        containerInfo={containerInfo}
      />
    </MiniAppInfoSection>
  );
}

export function ExplorerContainerInfoGroupShareSection(params: {
  draftShareAccessLevel: ContainerShareAccessLevel;
  draftShareGroupId: string;
  isSubmitting: boolean;
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>;
  setDraftShareAccessLevel: (value: ContainerShareAccessLevel) => void;
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
  const shareableGroups = getContainerInfoShareableGroups(remoteInfo);

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoShareToGroupHeading}
    >
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
            const accessLevel = event.target.value;
            if (isContainerShareAccessLevel(accessLevel)) {
              setDraftShareAccessLevel(accessLevel);
            }
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
    </MiniAppInfoSection>
  );
}

export function ExplorerContainerInfoPeerShareSection(params: {
  isSubmitting: boolean;
  onShareWithPeer: () => void;
}) {
  const { isSubmitting, onShareWithPeer } = params;

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoShareToPeerHeading}
    >
      <MiniAppButton
        className="explorer-info-inline-action"
        disabled={isSubmitting}
        onClick={onShareWithPeer}
      >
        {EXPLORER_LABELS.containerInfoShareToPeerAction}
      </MiniAppButton>
    </MiniAppInfoSection>
  );
}

export function ExplorerContainerInfoPrincipalGrantsSection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
}) {
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoPrincipalGrantsHeading}
    >
      <ExplorerContainerInfoGrantList
        containerNamesById={params.containerNamesById}
        containerInfo={params.remoteInfo}
        onOpenGrantGroup={params.onOpenGrantGroup}
      />
    </MiniAppInfoSection>
  );
}

export function ExplorerContainerInfoSyncCursorsSection(params: {
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>;
}) {
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoSyncCursorsHeading}
    >
      <ExplorerContainerInfoSyncCursorList containerInfo={params.remoteInfo} />
    </MiniAppInfoSection>
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
    <MiniAppHeader>
      <MiniAppHeaderCopy>
        <strong>{EXPLORER_LABELS.containerInfoTitle}</strong>
        <span>{containerName ?? compactId(containerId)}</span>
      </MiniAppHeaderCopy>
      <MiniAppActions>
        <MiniAppButton disabled={isSubmitting} onClick={onBackToContainer}>
          {EXPLORER_LABELS.backToContainerAction}
        </MiniAppButton>
      </MiniAppActions>
    </MiniAppHeader>
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
