import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { type KeyboardEvent, type ReactNode, useMemo } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppColumnVisibility,
} from "../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { useRoutedLayoutTier } from "../../navigation/useRoutedLayoutTier";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import {
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
  getGrantPrincipalLabel,
  isKeyboardActivationKey,
} from "./display";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerGrantRouteRef } from "./routes";

type GrantTableColumnId =
  | "principal"
  | "container"
  | "access"
  | "updated"
  | "action";

const GRANT_TABLE_COLUMN_IDS: ReadonlyArray<GrantTableColumnId> = [
  "principal",
  "container",
  "access",
  "updated",
  "action",
];
const GRANT_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<GrantTableColumnId> = [
  "container",
  "access",
  "updated",
];
const EMPTY_GRANT_HIDDEN_COLUMNS = new Set<GrantTableColumnId>();
const GRANT_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<GrantTableColumnId>
> = [
  { id: "container", label: ORG_MANAGER_LABELS.container },
  { id: "access", label: ORG_MANAGER_LABELS.access },
  { id: "updated", label: ORG_MANAGER_LABELS.updated },
];

const GRANT_TABLE_COLUMNS = [
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
    className: "org-manager-container-updated-column",
    id: "updated",
    header: ORG_MANAGER_LABELS.updated,
    width: "8rem",
  },
  {
    id: "action",
    header: ORG_MANAGER_LABELS.action,
    width: "6rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn & { id: GrantTableColumnId }>;

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
        <MiniAppTableCell
          className="org-manager-container-updated-column"
          key="updated"
        >
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

function useGrantTableColumns(): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  visibleColumnIds: ReadonlyArray<GrantTableColumnId>;
} {
  const compact = useRoutedLayoutTier() === "mobile";
  const columnVisibility = useMiniAppColumnVisibility<GrantTableColumnId>({
    storageKey: "tearleads.org-manager.grants:hidden-columns",
    toggleableColumnIds: GRANT_TOGGLEABLE_COLUMN_IDS,
  });
  const appliedHiddenColumns = compact
    ? EMPTY_GRANT_HIDDEN_COLUMNS
    : columnVisibility.hiddenColumns;
  const visibleColumnIds = useMemo(
    () =>
      getVisibleMiniAppTableColumnIds(
        GRANT_TABLE_COLUMN_IDS,
        appliedHiddenColumns,
      ),
    [appliedHiddenColumns],
  );
  const columns = useMemo(
    () =>
      addMiniAppTableHeaderAction(
        GRANT_TABLE_COLUMNS.filter(
          (column) => !appliedHiddenColumns.has(column.id),
        ),
        compact ? null : (
          <MiniAppColumnMenuButton
            ariaLabel={ORG_MANAGER_LABELS.columns}
            hiddenColumns={columnVisibility.hiddenColumns}
            options={GRANT_COLUMN_MENU_OPTIONS}
            stateLabels={{
              off: ORG_MANAGER_LABELS.columnsMenuStateOff,
              on: ORG_MANAGER_LABELS.columnsMenuStateOn,
            }}
            toggleColumn={columnVisibility.toggleColumn}
          />
        ),
      ),
    [
      appliedHiddenColumns,
      columnVisibility.hiddenColumns,
      columnVisibility.toggleColumn,
      compact,
    ],
  );

  return { columns, visibleColumnIds };
}

export function GrantTable({
  canRevokeGrants,
  emptyLabel,
  grants,
  label,
  mutating,
  openGrantRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  emptyLabel: string;
  grants: ReadonlyArray<OrganizationContainerGrant>;
  label: string;
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}) {
  const virtualGrants = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
    rows: grants,
  });
  const { columns, visibleColumnIds } = useGrantTableColumns();

  if (grants.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">{emptyLabel}</MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table"
      ref={virtualGrants.frameRef}
      style={getMiniAppVirtualFrameStyle(
        MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
      )}
    >
      <MiniAppTable aria-label={label} columns={columns}>
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualGrants.topPadding}
        />
        {virtualGrants.rows.map((grant) => {
          const canRevokeGrant = canRevokeGrants && !grant.isBuiltin;
          const openGrantDetailRoute = () => {
            openGrantRoute({
              containerId: grant.containerId,
              subjectId: grant.subjectId,
              subjectType: grant.subjectType,
            });
          };
          const handleGrantRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openGrantDetailRoute();
            }
          };

          return (
            <MiniAppTableRow
              interactive
              key={`${grant.subjectType}:${grant.subjectId}:${grant.containerId}:${grant.accessLevel}`}
              onClick={openGrantDetailRoute}
              onKeyDown={handleGrantRowKeyDown}
              role="button"
              tabIndex={0}
            >
              {visibleColumnIds.map((columnId) =>
                renderGrantCell(columnId, {
                  canRevokeGrant,
                  grant,
                  mutating,
                  revokeGrant,
                }),
              )}
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualGrants.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
