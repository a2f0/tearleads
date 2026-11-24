import { useMemo } from "react";
import {
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppCompactTableHeader,
  type MiniAppTableColumn,
  miniAppRowActionsColumn,
  useMiniAppColumnVisibility,
} from "../../../components/mini-app/MiniAppTable";
import { SHARED_WITH_ME_LABELS } from "../labels";

/** The columns after a row's name, each of which the column menu can hide. */
export type SharedWithMeDetailColumnId =
  | "organization"
  | "permission"
  | "status";

const DETAIL_COLUMN_IDS: ReadonlyArray<SharedWithMeDetailColumnId> = [
  "organization",
  "permission",
  "status",
];

export const SHARED_WITH_ME_DETAIL_COLUMN_LABELS: Readonly<
  Record<SharedWithMeDetailColumnId, string>
> = {
  organization: SHARED_WITH_ME_LABELS.organizationColumn,
  permission: SHARED_WITH_ME_LABELS.permissionColumn,
  status: SHARED_WITH_ME_LABELS.statusColumn,
};

const DETAIL_COLUMNS: Readonly<
  Record<SharedWithMeDetailColumnId, MiniAppTableColumn>
> = {
  organization: {
    header: SHARED_WITH_ME_LABELS.organizationColumn,
    id: "organization",
  },
  permission: {
    header: SHARED_WITH_ME_LABELS.permissionColumn,
    id: "permission",
    width: "7rem",
  },
  status: {
    header: SHARED_WITH_ME_LABELS.statusColumn,
    id: "status",
    width: "9rem",
  },
};

const COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<SharedWithMeDetailColumnId>
> = DETAIL_COLUMN_IDS.map((id) => ({
  id,
  label: SHARED_WITH_ME_DETAIL_COLUMN_LABELS[id],
}));

const HIDDEN_COLUMNS_STORAGE_KEY = "tearleads.shared-with-me:hidden-columns";

function nameColumn(
  detailColumnIds: ReadonlyArray<SharedWithMeDetailColumnId>,
): MiniAppTableColumn {
  // The organization column takes whatever the fixed columns leave. Once it is
  // hidden the name takes it instead, rather than the leftover being spread
  // over every column, the kebab's among them.
  return {
    header: SHARED_WITH_ME_LABELS.nameColumn,
    id: "name",
    width: detailColumnIds.includes("organization") ? "36%" : undefined,
  };
}

/**
 * The list's columns, in the shape Explorer's and Org Manager's lists take: the
 * name, the details the user has not hidden, and the kebab column, whose
 * heading carries the column menu. A phone folds the details into one summary
 * column's second line, and the menu stays with the kebab.
 */
export function useSharedWithMeColumns(compact: boolean): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  detailColumnIds: ReadonlyArray<SharedWithMeDetailColumnId>;
} {
  const { hiddenColumns, toggleColumn } =
    useMiniAppColumnVisibility<SharedWithMeDetailColumnId>({
      storageKey: HIDDEN_COLUMNS_STORAGE_KEY,
      toggleableColumnIds: DETAIL_COLUMN_IDS,
    });
  const detailColumnIds = useMemo(
    () => getVisibleMiniAppTableColumnIds(DETAIL_COLUMN_IDS, hiddenColumns),
    [hiddenColumns],
  );
  const columns = useMemo(() => {
    const actions = miniAppRowActionsColumn(
      SHARED_WITH_ME_LABELS.actionsColumn,
      <MiniAppColumnMenuButton
        ariaLabel={SHARED_WITH_ME_LABELS.columnsMenu}
        hiddenColumns={hiddenColumns}
        options={COLUMN_MENU_OPTIONS}
        stateLabels={{
          off: SHARED_WITH_ME_LABELS.columnsMenuStateOff,
          on: SHARED_WITH_ME_LABELS.columnsMenuStateOn,
        }}
        toggleColumn={toggleColumn}
      />,
    );
    if (compact) {
      const summary: MiniAppTableColumn = {
        header: (
          <MiniAppCompactTableHeader
            primary={[{ id: "name", text: SHARED_WITH_ME_LABELS.nameColumn }]}
            secondary={detailColumnIds.map((id) => ({
              id,
              text: SHARED_WITH_ME_DETAIL_COLUMN_LABELS[id],
            }))}
          />
        ),
        id: "summary",
      };
      return [summary, actions];
    }
    return [
      nameColumn(detailColumnIds),
      ...detailColumnIds.map((id) => DETAIL_COLUMNS[id]),
      actions,
    ];
  }, [compact, detailColumnIds, hiddenColumns, toggleColumn]);

  return { columns, detailColumnIds };
}
