import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  type MiniAppColumnMenuOption,
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppRowActionsCell,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppCompactTableRows,
} from "../../../components/mini-app/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
} from "../../../components/mini-app/virtual/MiniAppVirtual";
import { useRoutedLayoutActive } from "../../../navigation/useRoutedLayoutActive";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { isKeyboardActivationKey } from "../../../utils/keyboardActivation";
import {
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
  getGrantPrincipalLabel,
} from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { useOrgManagerTableColumns } from "../orgManagerTableColumns";
import type { OrgManagerGrantRouteRef } from "../routes";

type GrantTableColumnId =
  | "principal"
  | "container"
  | "access"
  | "updated"
  | "action";
type GrantDataColumnId = Exclude<GrantTableColumnId, "action">;

// The data columns without the trailing inline "action" (Revoke) column, used
// when the touch kebab replaces it.
const GRANT_DATA_COLUMN_IDS: ReadonlyArray<GrantDataColumnId> = [
  "principal",
  "container",
  "access",
  "updated",
];
const GRANT_COMPACT_PRIMARY_COLUMN_IDS: ReadonlyArray<GrantDataColumnId> = [
  "principal",
  "container",
];
const GRANT_COMPACT_SECONDARY_COLUMN_IDS: ReadonlyArray<GrantDataColumnId> = [
  "access",
  "updated",
];
const GRANT_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<GrantTableColumnId> = [
  "container",
  "access",
  "updated",
];
const GRANT_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<GrantTableColumnId>
> = [
  { id: "container", label: ORG_MANAGER_LABELS.container },
  { id: "access", label: ORG_MANAGER_LABELS.access },
  { id: "updated", label: ORG_MANAGER_LABELS.updated },
];

const GRANT_DATA_TABLE_COLUMNS = [
  {
    id: "principal",
    header: ORG_MANAGER_LABELS.principal,
    width: "34%",
  },
  {
    id: "container",
    header: ORG_MANAGER_LABELS.container,
    width: "34%",
  },
  {
    id: "access",
    header: ORG_MANAGER_LABELS.access,
    width: "7rem",
  },
  {
    id: "updated",
    header: ORG_MANAGER_LABELS.updated,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn & { id: GrantDataColumnId }>;

const GRANT_COLUMN_LABELS: Readonly<Record<GrantTableColumnId, string>> = {
  access: ORG_MANAGER_LABELS.access,
  action: ORG_MANAGER_LABELS.action,
  container: ORG_MANAGER_LABELS.container,
  principal: ORG_MANAGER_LABELS.principal,
  updated: ORG_MANAGER_LABELS.updated,
};

const GRANT_TABLE_COLUMNS_CONFIG = {
  // The inline Revoke column trails the data columns whenever the touch kebab
  // does not replace it.
  actionColumn: {
    id: "action",
    header: ORG_MANAGER_LABELS.action,
    width: "6rem",
  } satisfies MiniAppTableColumn & { id: GrantTableColumnId },
  allColumnIds: GRANT_DATA_COLUMN_IDS,
  columnLabels: GRANT_COLUMN_LABELS,
  compactPrimaryColumnIds: GRANT_COMPACT_PRIMARY_COLUMN_IDS,
  compactSecondaryColumnIds: GRANT_COMPACT_SECONDARY_COLUMN_IDS,
  dataColumns: GRANT_DATA_TABLE_COLUMNS,
  menuOptions: GRANT_COLUMN_MENU_OPTIONS,
  storageKey: "tearleads.org-manager.grants:hidden-columns",
  toggleableColumnIds: GRANT_TOGGLEABLE_COLUMN_IDS,
};

function renderGrantCell(
  columnId: GrantTableColumnId,
  params: {
    canRevokeGrant: boolean;
    grant: OrganizationContainerGrant;
    mutating: boolean;
    revokeGrant: (grant: OrganizationContainerGrant) => void;
  },
): ReactNode {
  const { canRevokeGrant, grant, mutating, revokeGrant } = params;
  switch (columnId) {
    case "principal":
      return (
        <MiniAppTableCell key="principal">
          <MiniAppTableText title={grant.subjectId}>
            {getGrantPrincipalLabel(grant)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "container":
      return (
        <MiniAppTableCell key="container">
          <MiniAppTableText title={getContainerDisplayTitle(grant)}>
            {getContainerDisplayLabel(grant)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "access":
      return (
        <MiniAppTableCell key="access">
          <MiniAppTableText>
            {getAccessLabel(grant.accessLevel)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "updated":
      return (
        <MiniAppTableCell key="updated">
          <MiniAppTableText title={grant.updatedAt}>
            {formatMiniAppDate(grant.updatedAt)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "action":
      return (
        <MiniAppTableCell key="action">
          {grant.isBuiltin ? (
            <MiniAppTableText>{ORG_MANAGER_LABELS.builtIn}</MiniAppTableText>
          ) : (
            <MiniAppButton
              block
              disabled={!canRevokeGrant || mutating}
              onClick={(event) => {
                event.stopPropagation();
                revokeGrant(grant);
              }}
              type="button"
            >
              {ORG_MANAGER_LABELS.revoke}
            </MiniAppButton>
          )}
        </MiniAppTableCell>
      );
  }
}

function getGrantCompactField(
  columnId: GrantDataColumnId,
  grant: OrganizationContainerGrant,
): MiniAppCompactTableField {
  switch (columnId) {
    case "principal":
      return {
        id: columnId,
        label: GRANT_COLUMN_LABELS[columnId],
        text: getGrantPrincipalLabel(grant),
        title: grant.subjectId,
      };
    case "container":
      return {
        id: columnId,
        label: GRANT_COLUMN_LABELS[columnId],
        text: getContainerDisplayLabel(grant),
        title: getContainerDisplayTitle(grant),
      };
    case "access":
      return {
        id: columnId,
        label: GRANT_COLUMN_LABELS[columnId],
        text: getAccessLabel(grant.accessLevel),
      };
    case "updated":
      return {
        id: columnId,
        label: GRANT_COLUMN_LABELS[columnId],
        text: formatMiniAppDate(grant.updatedAt),
        title: grant.updatedAt,
      };
  }
}

interface GrantTableRowProps {
  canRevokeGrants: boolean;
  compact: boolean;
  grant: OrganizationContainerGrant;
  mutating: boolean;
  openGrantContextMenu?:
    | ((
        event: MouseEvent<HTMLElement>,
        grant: OrganizationContainerGrant,
      ) => void)
    | undefined;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  showActions: boolean;
  visibleColumnIds: ReadonlyArray<GrantTableColumnId>;
}

function GrantTableRow({
  canRevokeGrants,
  compact,
  grant,
  mutating,
  openGrantContextMenu,
  openGrantRoute,
  revokeGrant,
  showActions,
  visibleColumnIds,
}: GrantTableRowProps) {
  const canRevokeGrant = canRevokeGrants && !grant.isBuiltin;
  const openGrantDetailRoute = () =>
    openGrantRoute({
      containerId: grant.containerId,
      subjectId: grant.subjectId,
      subjectType: grant.subjectType,
    });
  const handleGrantRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (isKeyboardActivationKey(event.key)) {
      event.preventDefault();
      openGrantDetailRoute();
    }
  };
  const renderCell = (columnId: GrantTableColumnId) =>
    renderGrantCell(columnId, {
      canRevokeGrant,
      grant,
      mutating,
      revokeGrant,
    });

  return (
    <MiniAppTableRow
      interactive
      onClick={openGrantDetailRoute}
      onContextMenu={
        openGrantContextMenu
          ? (event) => openGrantContextMenu(event, grant)
          : undefined
      }
      onKeyDown={handleGrantRowKeyDown}
      role="button"
      tabIndex={0}
    >
      {compact ? (
        <MiniAppCompactTableCell
          primary={GRANT_COMPACT_PRIMARY_COLUMN_IDS.filter((id) =>
            visibleColumnIds.includes(id),
          ).map((id) => getGrantCompactField(id, grant))}
          secondary={GRANT_COMPACT_SECONDARY_COLUMN_IDS.filter((id) =>
            visibleColumnIds.includes(id),
          ).map((id) => getGrantCompactField(id, grant))}
        />
      ) : (
        visibleColumnIds.map(renderCell)
      )}
      {showActions ? (
        <MiniAppRowActionsCell
          label={`${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${getGrantPrincipalLabel(grant)}`}
          onOpen={(event) => openGrantContextMenu?.(event, grant)}
        />
      ) : (
        renderCell("action")
      )}
    </MiniAppTableRow>
  );
}

export function GrantTable({
  canRevokeGrants,
  emptyLabel,
  grants,
  label,
  mutating,
  openGrantContextMenu,
  openGrantRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  emptyLabel: string;
  grants: ReadonlyArray<OrganizationContainerGrant>;
  label: string;
  mutating: boolean;
  openGrantContextMenu?:
    | ((
        event: MouseEvent<HTMLElement>,
        grant: OrganizationContainerGrant,
      ) => void)
    | undefined;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}) {
  const virtualGrants = useMiniAppCompactTableRows({ rows: grants });
  const { compact, rowHeight } = virtualGrants;
  // Touch layouts have no right-click; the kebab replaces the inline Revoke
  // button and opens the same Open / Revoke menu right-click / long-press does.
  const showActions = useRoutedLayoutActive() && Boolean(openGrantContextMenu);
  const { columns, visibleColumnIds } = useOrgManagerTableColumns(
    GRANT_TABLE_COLUMNS_CONFIG,
    showActions,
    compact,
  );

  if (grants.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">{emptyLabel}</MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className={`mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table${
        compact ? " mini-app-table-frame--two-line" : ""
      }`}
      ref={virtualGrants.frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable aria-label={label} columns={columns}>
        <MiniAppVirtualTableSpacerRow
          colSpan={columns.length}
          height={virtualGrants.topPadding}
        />
        {virtualGrants.rows.map((grant) => (
          <GrantTableRow
            canRevokeGrants={canRevokeGrants}
            compact={compact}
            grant={grant}
            key={`${grant.subjectType}:${grant.subjectId}:${grant.containerId}:${grant.accessLevel}`}
            mutating={mutating}
            openGrantContextMenu={openGrantContextMenu}
            openGrantRoute={openGrantRoute}
            revokeGrant={revokeGrant}
            showActions={showActions}
            visibleColumnIds={visibleColumnIds}
          />
        ))}
        <MiniAppVirtualTableSpacerRow
          colSpan={columns.length}
          height={virtualGrants.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
