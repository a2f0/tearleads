import type {
  ContainerInfo,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import type { KeyboardEvent, MouseEvent } from "react";
import { MiniAppSelectMenu } from "../../../../components/mini-app/controls/MiniAppSelectMenu";
import {
  MiniAppButton,
  MiniAppFieldGroup,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoTable,
  MiniAppInfoTableRow,
} from "../../../../components/mini-app/MiniAppTable";
import { isKeyboardActivationKey } from "../../../../utils/keyboardActivation";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoInheritedGrantSource,
} from "../../labels";
import type { MiniAppWindowPosition } from "../../types";
import type { ExplorerAttributionUserLabelResolver } from "../attributionDisplay";
import { compactId } from "../compactId";
import type {
  ExplorerContainerInfoShareDraft,
  ExplorerShareSubjectType,
} from "./useExplorerContainerInfoPanelState";

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
  user: EXPLORER_LABELS.containerInfoSubjectTypeUser,
} satisfies Record<ExplorerContainerInfoGrantSubjectType, string>;

const SHARE_SUBJECT_TYPE_OPTIONS = [
  {
    id: "group",
    label: EXPLORER_LABELS.containerInfoShareSubjectGroupOption,
  },
  {
    id: "user",
    label: EXPLORER_LABELS.containerInfoShareSubjectUserOption,
  },
] satisfies ReadonlyArray<{ id: ExplorerShareSubjectType; label: string }>;

const GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET = 16;

function isContainerShareAccessLevel(
  value: string,
): value is ContainerShareAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

function isShareSubjectType(value: string): value is ExplorerShareSubjectType {
  return value === "group" || value === "user";
}

function principalLabel(
  subjectType: string,
  subjectId: string,
  containerInfo: NonNullable<ContainerInfo["remoteInfo"]>,
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined,
): string {
  if (subjectType === "group") {
    const group = containerInfo.groups.find(
      (candidate) => candidate.groupId === subjectId,
    );
    if (group && !group.nameUnreadable && group.name !== "") {
      return group.name;
    }
  } else if (subjectType === "user") {
    const userLabel = resolveUserLabel?.(subjectId);
    if (userLabel) {
      return userLabel;
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
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined;
}) {
  const { containerInfo, containerNamesById, onOpenGrant, resolveUserLabel } =
    params;
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
                  resolveUserLabel,
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
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined;
}) {
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoPrincipalGrantsHeading}
    >
      <ExplorerContainerInfoGrantList
        containerNamesById={params.containerNamesById}
        containerInfo={params.remoteInfo}
        onOpenGrant={params.onOpenGrant}
        resolveUserLabel={params.resolveUserLabel}
      />
    </MiniAppInfoSection>
  );
}

// Picks the recipient kind, then the group or roster user, then the
// permission; the panel's Share button submits the pick.
export function ExplorerContainerInfoNewShareSection(params: {
  isSubmitting: boolean;
  setPanelError: (error: string | null) => void;
  shareDraft: ExplorerContainerInfoShareDraft;
}) {
  const { isSubmitting, setPanelError, shareDraft } = params;
  const isGroupShare = shareDraft.subjectType === "group";
  const recipientOptions = isGroupShare
    ? shareDraft.groupOptions
    : shareDraft.userOptions;
  const recipientField = isGroupShare
    ? EXPLORER_LABELS.containerInfoGroupField
    : EXPLORER_LABELS.containerInfoUserField;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.containerInfoNewShareHeading}>
      <MiniAppFieldGroup>
        <span>{EXPLORER_LABELS.containerInfoShareSubjectField}</span>
        <MiniAppSelectMenu
          ariaLabel={EXPLORER_LABELS.containerInfoShareSubjectField}
          disabled={isSubmitting}
          value={shareDraft.subjectType}
          onChange={(value) => {
            setPanelError(null);
            if (isShareSubjectType(value)) {
              shareDraft.setSubjectType(value);
            }
          }}
          options={SHARE_SUBJECT_TYPE_OPTIONS}
        />
      </MiniAppFieldGroup>
      <MiniAppFieldGroup>
        <span>{recipientField}</span>
        <MiniAppSelectMenu
          ariaLabel={recipientField}
          disabled={isSubmitting || recipientOptions.length === 0}
          value={isGroupShare ? shareDraft.groupId : shareDraft.userId}
          onChange={(value) => {
            setPanelError(null);
            if (isGroupShare) {
              shareDraft.setGroupId(value);
            } else {
              shareDraft.setUserId(value);
            }
          }}
          options={recipientOptions}
          placeholder={
            isGroupShare
              ? EXPLORER_LABELS.containerInfoNoGroupsOption
              : EXPLORER_LABELS.containerInfoNoUsersOption
          }
        />
      </MiniAppFieldGroup>
      <MiniAppFieldGroup>
        <span>{EXPLORER_LABELS.containerInfoPermissionField}</span>
        <MiniAppSelectMenu
          ariaLabel={EXPLORER_LABELS.containerInfoPermissionField}
          disabled={isSubmitting || recipientOptions.length === 0}
          value={shareDraft.accessLevel}
          onChange={(accessLevel) => {
            setPanelError(null);
            if (isContainerShareAccessLevel(accessLevel)) {
              shareDraft.setAccessLevel(accessLevel);
            }
          }}
          options={(["read", "write", "admin"] as const).map((id) => ({
            id,
            label: getContainerInfoPermissionLabel(id),
          }))}
        />
      </MiniAppFieldGroup>
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
