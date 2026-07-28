import type {
  ContainerInfo,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import type { KeyboardEvent, MouseEvent } from "react";
import { MiniAppSelectMenu } from "../../../../components/mini-app/controls/MiniAppSelectMenu";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoTable,
  MiniAppInfoTableRow,
} from "../../../../components/mini-app/MiniAppTable";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoInheritedGrantSource,
} from "../../labels";
import type { MiniAppWindowPosition } from "../../types";
import { compactId } from "../compactId";
import { getContainerInfoShareableGroups } from "./explorerContainerInfoStateHelpers";

type ExplorerContainerInfoGrantSubjectType = NonNullable<
  ContainerInfo["remoteInfo"]
>["grants"][number]["subjectType"];

type ExplorerContainerInfoGrantRow = NonNullable<
  ContainerInfo["remoteInfo"]
>["grantRows"][number];

interface ExplorerContainerInfoGrantRouteTarget {
  containerId: string;
  subjectId: string;
  subjectType: ExplorerContainerInfoGrantSubjectType;
}

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

function ExplorerContainerInfoGrantList(params: {
  containerNamesById: ReadonlyMap<string, string>;
  containerInfo: NonNullable<ContainerInfo["remoteInfo"]>;
  onOpenGrant: (
    grant: ExplorerContainerInfoGrantRouteTarget,
    position?: MiniAppWindowPosition,
  ) => void;
}) {
  const { containerInfo, containerNamesById, onOpenGrant } = params;
  if (containerInfo.grantRows.length === 0) {
    return (
      <MiniAppStatus>{EXPLORER_LABELS.containerInfoNoGrants}</MiniAppStatus>
    );
  }

  return (
    <MiniAppInfoTable className="mini-app-info-table--row-divided">
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
          const openGrantRoute = (position?: MiniAppWindowPosition) => {
            onOpenGrant(
              {
                containerId: grant.sourceContainerId,
                subjectId: grant.subjectId,
                subjectType: grant.subjectType,
              },
              position,
            );
          };
          const handleGrantRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (!isKeyboardActivationKey(event.key)) {
              return;
            }

            event.preventDefault();
            openGrantRoute(getKeyboardEventPosition(event));
          };

          return (
            <MiniAppInfoTableRow
              interactive
              key={`${grant.sourceContainerId}:${grant.subjectType}:${grant.subjectId}`}
              onClick={(event) => openGrantRoute(getMouseEventPosition(event))}
              onKeyDown={handleGrantRowKeyDown}
              role="button"
              tabIndex={0}
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

export function ExplorerContainerInfoPrincipalGrantsSection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>;
  onOpenGrant: (
    grant: ExplorerContainerInfoGrantRouteTarget,
    position?: MiniAppWindowPosition,
  ) => void;
}) {
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoPrincipalGrantsHeading}
    >
      <ExplorerContainerInfoGrantList
        containerNamesById={params.containerNamesById}
        containerInfo={params.remoteInfo}
        onOpenGrant={params.onOpenGrant}
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
        <MiniAppSelectMenu
          ariaLabel={EXPLORER_LABELS.containerInfoGroupField}
          disabled={isSubmitting || shareableGroups.length === 0}
          value={draftShareGroupId}
          onChange={(value) => {
            setPanelError(null);
            setDraftShareGroupId(value);
          }}
          options={shareableGroups.map((group) => ({
            id: group.groupId,
            label: group.name,
          }))}
          placeholder={EXPLORER_LABELS.containerInfoNoGroupsOption}
        />
      </MiniAppField>
      <MiniAppField>
        <span>{EXPLORER_LABELS.containerInfoPermissionField}</span>
        <MiniAppSelectMenu
          ariaLabel={EXPLORER_LABELS.containerInfoPermissionField}
          disabled={isSubmitting || shareableGroups.length === 0}
          value={draftShareAccessLevel}
          onChange={(accessLevel) => {
            setPanelError(null);
            if (isContainerShareAccessLevel(accessLevel)) {
              setDraftShareAccessLevel(accessLevel);
            }
          }}
          options={(["read", "write", "admin"] as const).map((id) => ({
            id,
            label: getContainerInfoPermissionLabel(id),
          }))}
        />
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
