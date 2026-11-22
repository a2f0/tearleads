import { BuildingOfficeIcon } from "@phosphor-icons/react/dist/csr/BuildingOffice";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import type { MouseEvent } from "react";
import {
  MiniAppCompactTableCell,
  MiniAppCompactTableHeader,
  MiniAppRowActionsCell,
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  miniAppRowActionsColumn,
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

const ACTIONS_COLUMN = miniAppRowActionsColumn(
  SHARED_WITH_ME_LABELS.actionsColumn,
);

const WIDE_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: SHARED_WITH_ME_LABELS.nameColumn, id: "name", width: "36%" },
  { header: SHARED_WITH_ME_LABELS.organizationColumn, id: "organization" },
  {
    header: SHARED_WITH_ME_LABELS.permissionColumn,
    id: "permission",
    width: "7rem",
  },
  { header: SHARED_WITH_ME_LABELS.statusColumn, id: "status", width: "9rem" },
  ACTIONS_COLUMN,
];

/** The folded row's muted second line, in order. */
const SECONDARY_FIELDS = [
  { id: "organization", label: SHARED_WITH_ME_LABELS.organizationColumn },
  { id: "permission", label: SHARED_WITH_ME_LABELS.permissionColumn },
  { id: "status", label: SHARED_WITH_ME_LABELS.statusColumn },
] as const;

const COMPACT_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  {
    header: (
      <MiniAppCompactTableHeader
        primary={[{ id: "name", text: SHARED_WITH_ME_LABELS.nameColumn }]}
        secondary={SECONDARY_FIELDS.map((field) => ({
          id: field.id,
          text: field.label,
        }))}
      />
    ),
    id: "summary",
  },
  ACTIONS_COLUMN,
];

interface RowParams {
  changing: boolean;
  compact: boolean;
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

function RowCells(params: RowParams) {
  const { changing, compact, onOpenFolder, row } = params;
  const organizationName = organizationDisplayName(row.organization);
  const permission = rowPermissionLabel(row);
  const status = rowStatusText(row, changing);

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
        secondary={[
          { ...SECONDARY_FIELDS[0], text: organizationName },
          { ...SECONDARY_FIELDS[1], text: permission },
          { ...SECONDARY_FIELDS[2], text: status.label, title: status.title },
        ]}
        visual={<RowIcon row={row} size={32} />}
      />
    );
  }

  return (
    <>
      <MiniAppTableCell>
        <RowName onOpenFolder={onOpenFolder} row={row} showIcon />
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={organizationName}>
          {organizationName}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText>{permission}</MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={status.title}>{status.label}</MiniAppTableText>
      </MiniAppTableCell>
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
  return (
    <MiniAppTableFrame
      className={classNames(
        "shared-with-me-table-wrap",
        "mini-app-table-frame--compact",
        "mini-app-table-frame--bleed",
        "mini-app-table-frame--bleed-block-end",
        compact && "mini-app-table-frame--two-line",
      )}
      ref={frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable
        aria-label={SHARED_WITH_ME_LABELS.title}
        columns={compact ? COMPACT_COLUMNS : WIDE_COLUMNS}
      >
        {rows.map((row) => (
          <SharedWithMeTableRow
            changing={
              changingOrganizationId === row.organization.organizationId
            }
            compact={compact}
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
