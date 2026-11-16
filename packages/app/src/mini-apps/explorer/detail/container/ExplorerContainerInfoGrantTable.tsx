import type {
  ContainerInfo,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import { type KeyboardEvent, type MouseEvent, useMemo } from "react";
import { MiniAppStatus } from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppCompactTableHeader,
  MiniAppRowActionsCell,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  miniAppRowActionsColumn,
  useMiniAppCompactTableFrame,
} from "../../../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import { isKeyboardActivationKey } from "../../../../utils/keyboardActivation";
import { useGrantRowMenu } from "../../../shared/grants/useGrantRowMenu";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoInheritedGrantSource,
} from "../../labels";
import type { MiniAppWindowPosition } from "../../types";
import type { ExplorerAttributionUserLabelResolver } from "../attributionDisplay";
import { compactId } from "../compactId";

type ExplorerContainerInfoRemoteInfo = NonNullable<ContainerInfo["remoteInfo"]>;

type ExplorerContainerInfoGrantSubjectType =
  ExplorerContainerInfoRemoteInfo["grants"][number]["subjectType"];

type ExplorerContainerInfoGrantRow =
  ExplorerContainerInfoRemoteInfo["grantRows"][number];

export interface ExplorerContainerInfoGrantRouteTarget {
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

const GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET = 16;

/** Every column after Principal, in order. Folded they join into one line. */
const GRANT_SECONDARY_COLUMNS = [
  { id: "type", label: EXPLORER_LABELS.containerInfoTypeColumn },
  { id: "permission", label: EXPLORER_LABELS.containerInfoPermissionColumn },
  { id: "source", label: EXPLORER_LABELS.containerInfoSourceColumn },
] as const;

const GRANT_SECONDARY_SEPARATOR = " · ";

// The folded second line reads as one phrase ("Group · Write · Inherited from
// X"): the values describe themselves, and three equal fields would each
// truncate on a phone.
const GRANT_SECONDARY_LABEL = GRANT_SECONDARY_COLUMNS.map(
  (column) => column.label,
).join(GRANT_SECONDARY_SEPARATOR);

export function getContainerInfoPermissionLabel(
  accessLevel: ContainerShareAccessLevel,
): string {
  return CONTAINER_INFO_PERMISSION_LABELS[accessLevel];
}

function principalLabel(
  grant: ExplorerContainerInfoGrantRow,
  containerInfo: ExplorerContainerInfoRemoteInfo,
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined,
): string {
  if (grant.subjectType === "group") {
    const group = containerInfo.groups.find(
      (candidate) => candidate.groupId === grant.subjectId,
    );
    if (group && !group.nameUnreadable && group.name !== "") {
      return group.name;
    }
  } else if (grant.subjectType === "user") {
    const userLabel = resolveUserLabel?.(grant.subjectId);
    if (userLabel) {
      return userLabel;
    }
  }

  return compactId(grant.subjectId);
}

function grantSourceLabel(
  grant: ExplorerContainerInfoGrantRow,
  containerNamesById: ReadonlyMap<string, string>,
): string {
  if (!grant.inherited) {
    return EXPLORER_LABELS.containerInfoSourceDirect;
  }

  return getExplorerContainerInfoInheritedGrantSource(
    containerNamesById.get(grant.sourceContainerId) ??
      compactId(grant.sourceContainerId),
  );
}

function offsetGrantRouteWindowPosition(point: {
  x: number;
  y: number;
}): MiniAppWindowPosition {
  return {
    x: point.x + GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET,
    y: point.y + GRANT_GROUP_ROUTE_WINDOW_POSITION_OFFSET,
  };
}

function getKeyboardEventPosition(
  event: KeyboardEvent<HTMLTableRowElement>,
): MiniAppWindowPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return offsetGrantRouteWindowPosition({ x: rect.left, y: rect.top });
}

function getMouseEventPosition(
  event: MouseEvent<HTMLTableRowElement>,
): MiniAppWindowPosition {
  return offsetGrantRouteWindowPosition({ x: event.clientX, y: event.clientY });
}

// An inherited row's grant lives on its source container, so that is the grant
// Org Manager opens.
function getGrantRouteTarget(
  grant: ExplorerContainerInfoGrantRow,
): ExplorerContainerInfoGrantRouteTarget {
  return {
    containerId: grant.sourceContainerId,
    subjectId: grant.subjectId,
    subjectType: grant.subjectType,
  };
}

/**
 * Folded, principal leads over one joined Type · Permission · Source line; the
 * kebab keeps its own trailing column in both layouts.
 */
function getGrantColumns(compact: boolean): ReadonlyArray<MiniAppTableColumn> {
  const actions = miniAppRowActionsColumn(EXPLORER_LABELS.itemActionsColumn);
  if (compact) {
    return [
      {
        header: (
          <MiniAppCompactTableHeader
            primary={[
              {
                id: "principal",
                text: EXPLORER_LABELS.containerInfoPrincipalColumn,
              },
            ]}
            secondary={[{ id: "details", text: GRANT_SECONDARY_LABEL }]}
          />
        ),
        id: "summary",
      },
      actions,
    ];
  }

  return [
    {
      header: EXPLORER_LABELS.containerInfoPrincipalColumn,
      id: "principal",
    },
    ...GRANT_SECONDARY_COLUMNS.map((column) => ({
      header: column.label,
      id: column.id,
    })),
    actions,
  ];
}

function getGrantSecondaryFields(
  grant: ExplorerContainerInfoGrantRow,
  containerNamesById: ReadonlyMap<string, string>,
): ReadonlyArray<MiniAppCompactTableField> {
  const [type, permission, source] = GRANT_SECONDARY_COLUMNS;
  return [
    {
      ...type,
      text: CONTAINER_INFO_SUBJECT_TYPE_LABELS[grant.subjectType],
    },
    {
      ...permission,
      text: getContainerInfoPermissionLabel(grant.accessLevel),
    },
    {
      ...source,
      text: grantSourceLabel(grant, containerNamesById),
      title: grant.sourceContainerId,
    },
  ];
}

function getGrantFoldedSecondaryField(
  fields: ReadonlyArray<MiniAppCompactTableField>,
  grant: ExplorerContainerInfoGrantRow,
): MiniAppCompactTableField {
  return {
    id: "details",
    label: GRANT_SECONDARY_LABEL,
    text: fields.map((field) => field.text).join(GRANT_SECONDARY_SEPARATOR),
    title: grant.sourceContainerId,
  };
}

function GrantRow(params: {
  compact: boolean;
  containerNamesById: ReadonlyMap<string, string>;
  grant: ExplorerContainerInfoGrantRow;
  onOpenGrant: (position?: MiniAppWindowPosition) => void;
  openGrantRowMenu: (
    event: MouseEvent<HTMLElement>,
    grant: ExplorerContainerInfoGrantRow,
  ) => void;
  principal: string;
}) {
  const { compact, grant, onOpenGrant, openGrantRowMenu, principal } = params;
  const secondary = getGrantSecondaryFields(grant, params.containerNamesById);
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (!isKeyboardActivationKey(event.key)) {
      return;
    }

    event.preventDefault();
    onOpenGrant(getKeyboardEventPosition(event));
  };

  return (
    <MiniAppTableRow
      interactive
      onActivate={(event) => onOpenGrant(getMouseEventPosition(event))}
      onContextMenu={(event) => openGrantRowMenu(event, grant)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      {compact ? (
        <MiniAppCompactTableCell
          primary={[
            { id: "principal", text: principal, title: grant.subjectId },
          ]}
          secondary={[getGrantFoldedSecondaryField(secondary, grant)]}
        />
      ) : (
        <>
          <MiniAppTableCell>
            <MiniAppTableText title={grant.subjectId}>
              {principal}
            </MiniAppTableText>
          </MiniAppTableCell>
          {secondary.map((field) => (
            <MiniAppTableCell key={field.id}>
              <MiniAppTableText title={field.title}>
                {field.text}
              </MiniAppTableText>
            </MiniAppTableCell>
          ))}
        </>
      )}
      <MiniAppRowActionsCell
        label={`${EXPLORER_LABELS.itemActionsButtonPrefix} ${principal}`}
        onOpen={(event) => openGrantRowMenu(event, grant)}
      />
    </MiniAppTableRow>
  );
}

export function ExplorerContainerInfoGrantList(params: {
  containerNamesById: ReadonlyMap<string, string>;
  containerInfo: ExplorerContainerInfoRemoteInfo;
  onOpenGrant: (
    grant: ExplorerContainerInfoGrantRouteTarget,
    position?: MiniAppWindowPosition,
  ) => void;
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined;
}) {
  const { containerInfo, onOpenGrant } = params;
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const columns = useMemo(() => getGrantColumns(compact), [compact]);
  // Open only: revoking stays in Org Manager.
  const { grantRowMenu, openGrantRowMenu } =
    useGrantRowMenu<ExplorerContainerInfoGrantRow>({
      onOpen: (grant, position) =>
        onOpenGrant(
          getGrantRouteTarget(grant),
          offsetGrantRouteWindowPosition(position),
        ),
    });
  if (containerInfo.grantRows.length === 0) {
    return (
      <MiniAppStatus>{EXPLORER_LABELS.containerInfoNoGrants}</MiniAppStatus>
    );
  }

  return (
    <>
      <MiniAppTableFrame
        className={classNames(
          compact &&
            "mini-app-table-frame--compact mini-app-table-frame--two-line",
        )}
        ref={frameRef}
        style={getMiniAppVirtualFrameStyle(rowHeight)}
      >
        <MiniAppTable
          aria-label={EXPLORER_LABELS.containerInfoPrincipalGrantsHeading}
          columns={columns}
        >
          {containerInfo.grantRows.map((grant) => (
            <GrantRow
              compact={compact}
              containerNamesById={params.containerNamesById}
              grant={grant}
              key={`${grant.sourceContainerId}:${grant.subjectType}:${grant.subjectId}`}
              onOpenGrant={(position) =>
                onOpenGrant(getGrantRouteTarget(grant), position)
              }
              openGrantRowMenu={openGrantRowMenu}
              principal={principalLabel(
                grant,
                containerInfo,
                params.resolveUserLabel,
              )}
            />
          ))}
        </MiniAppTable>
      </MiniAppTableFrame>
      {grantRowMenu}
    </>
  );
}
