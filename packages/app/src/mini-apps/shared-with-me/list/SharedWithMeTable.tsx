import { BuildingOfficeIcon } from "@phosphor-icons/react/dist/csr/BuildingOffice";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import type { MouseEvent } from "react";
import {
  MiniAppCompactTableCell,
  MiniAppRowActionsCell,
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppCompactTableFrame,
} from "../../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../components/shared/classNames";
import { SHARED_WITH_ME_LABELS } from "../labels";
import {
  organizationDisplayName,
  rowDisplayName,
  rowPermissionLabel,
  rowStatusText,
} from "../model/sharedWithMeRowDisplay";
import type { SharedWithMeRow } from "../model/sharedWithMeRows";
import {
  SHARED_WITH_ME_DETAIL_COLUMN_LABELS,
  type SharedWithMeDetailColumnId,
  useSharedWithMeColumns,
} from "./sharedWithMeColumns";

interface RowParams {
  changing: boolean;
  compact: boolean;
  detailColumnIds: ReadonlyArray<SharedWithMeDetailColumnId>;
  onOpenFolder: (folderId: string) => void;
  onRowContextMenu: (event: MouseEvent<HTMLElement>, rowKey: string) => void;
  row: SharedWithMeRow;
  selected: boolean;
}

function RowIcon({ row, size }: { row: SharedWithMeRow; size: number }) {
  const Icon = row.kind === "folder" ? FolderIcon : BuildingOfficeIcon;
  return (
    <Icon
      aria-hidden="true"
      className="shared-with-me-icon"
      focusable="false"
      size={size}
    />
  );
}

/**
 * A folder row's name is a real button carrying the row's open action, so
 * keyboard and screen-reader users reach it the same way a click does. An
 * organization row has nothing to open, so its name is plain text.
 */
function RowName({
  onOpenFolder,
  row,
  showIcon,
}: Pick<RowParams, "onOpenFolder" | "row"> & { showIcon: boolean }) {
  const name = rowDisplayName(row);
  const content = (
    <span className="shared-with-me-name">
      {showIcon ? <RowIcon row={row} size={16} /> : null}
      <MiniAppTableText title={name}>{name}</MiniAppTableText>
    </span>
  );
  if (row.kind !== "folder") return content;
  const folderId = row.folder.id;
  return (
    <MiniAppTableActionButton onClick={() => onOpenFolder(folderId)}>
      {content}
    </MiniAppTableActionButton>
  );
}

/** A detail column's text for a row, and the fuller text its tooltip gives. */
function rowDetail(
  row: SharedWithMeRow,
  columnId: SharedWithMeDetailColumnId,
  changing: boolean,
): { text: string; title?: string | undefined } {
  switch (columnId) {
    case "organization": {
      const name = organizationDisplayName(row.organization);
      return { text: name, title: name };
    }
    case "permission":
      return { text: rowPermissionLabel(row) };
    case "status": {
      const status = rowStatusText(row, changing);
      return { text: status.label, title: status.title };
    }
  }
}

function RowCells(params: RowParams) {
  const { changing, compact, detailColumnIds, onOpenFolder, row } = params;

  if (compact) {
    return (
      <MiniAppCompactTableCell
        primary={[
          {
            content: (
              <RowName onOpenFolder={onOpenFolder} row={row} showIcon={false} />
            ),
            id: "name",
          },
        ]}
        secondary={detailColumnIds.map((id) => ({
          id,
          label: SHARED_WITH_ME_DETAIL_COLUMN_LABELS[id],
          ...rowDetail(row, id, changing),
        }))}
        visual={<RowIcon row={row} size={32} />}
      />
    );
  }

  return (
    <>
      <MiniAppTableCell>
        <RowName onOpenFolder={onOpenFolder} row={row} showIcon />
      </MiniAppTableCell>
      {detailColumnIds.map((id) => {
        const detail = rowDetail(row, id, changing);
        return (
          <MiniAppTableCell key={id}>
            <MiniAppTableText title={detail.title}>
              {detail.text}
            </MiniAppTableText>
          </MiniAppTableCell>
        );
      })}
    </>
  );
}

function SharedWithMeTableRow(params: RowParams) {
  const { onOpenFolder, onRowContextMenu, row, selected } = params;
  const openMenu = (event: MouseEvent<HTMLElement>) =>
    onRowContextMenu(event, row.key);
  return (
    <MiniAppTableRow
      className="shared-with-me-row"
      interactive
      onActivate={
        row.kind === "folder" ? () => onOpenFolder(row.folder.id) : undefined
      }
      onContextMenu={openMenu}
      selected={selected}
    >
      <RowCells {...params} />
      <MiniAppRowActionsCell
        label={SHARED_WITH_ME_LABELS.actionsFor(rowDisplayName(row))}
        onOpen={openMenu}
      />
    </MiniAppTableRow>
  );
}

/**
 * Every folder shared with the user, grouped by the organization it came from,
 * in Explorer's list style: a click opens the folder, and a right-click,
 * long-press, or the row's actions button lists what else the row offers.
 */
export function SharedWithMeTable({
  changingOrganizationId,
  contextRowKey,
  onOpenFolder,
  onRowContextMenu,
  rows,
}: {
  changingOrganizationId: string | null;
  /** The row whose context menu is open, highlighted while it is. */
  contextRowKey: string | null;
  onOpenFolder: (folderId: string) => void;
  onRowContextMenu: (event: MouseEvent<HTMLElement>, rowKey: string) => void;
  rows: ReadonlyArray<SharedWithMeRow>;
}) {
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const { columns, detailColumnIds } = useSharedWithMeColumns(compact);
  return (
    <MiniAppTableFrame
      className={classNames(
        "shared-with-me-table-wrap",
        "mini-app-table-frame--compact",
        "mini-app-table-frame--bleed",
        "mini-app-table-frame--edges",
        "mini-app-table-frame--bleed-block-end",
        compact && "mini-app-table-frame--two-line",
      )}
      ref={frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable aria-label={SHARED_WITH_ME_LABELS.title} columns={columns}>
        {rows.map((row) => (
          <SharedWithMeTableRow
            changing={
              changingOrganizationId === row.organization.organizationId
            }
            compact={compact}
            detailColumnIds={detailColumnIds}
            key={row.key}
            onOpenFolder={onOpenFolder}
            onRowContextMenu={onRowContextMenu}
            row={row}
            selected={row.key === contextRowKey}
          />
        ))}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
