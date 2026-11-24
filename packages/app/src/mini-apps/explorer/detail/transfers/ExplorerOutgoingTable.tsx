import type { PendingWriteQueueItem } from "@tearleads/client-sdk";
import { useRoutedLayoutTier } from "@tearleads/windowing";
import { type ReactNode, useState } from "react";
import { useClipboardCopy } from "../../../../components/mini-app/controls/MiniAppButton";
import { MiniAppButton } from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  miniAppRowActionsColumn,
} from "../../../../components/mini-app/MiniAppTable";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import { WriteQueueRowActionsCell } from "../sync/ExplorerWriteQueueRowActions";
import { getWriteQueueEntryClipboardText } from "../sync/writeQueueEntryClipboardText";
import {
  canDiscardWriteQueueItem,
  getOperationsLabel,
  getWriteQueueItemIdentity,
  getWriteQueueItemKey,
  getWriteQueueItemName,
} from "../sync/writeQueueItems";
import {
  ExplorerTransferNameCell,
  type ExplorerTransferOpenAction,
  ExplorerTransferStatusCell,
} from "./ExplorerTransferCells";
import { isBillingBlockedWrite, type OutgoingRow } from "./outgoingRows";
import "./ExplorerOutgoingTable.css";

// Rows shown before the user asks for more; a 1000-file stress upload should
// not render a 1000-row table by default.
const OUTGOING_ROW_LIMIT = 100;

const OUTGOING_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  // The object flexes so its progress bar spans the rest of the row.
  { header: EXPLORER_LABELS.writeQueueObjectColumn, id: "object" },
  {
    header: EXPLORER_LABELS.writeQueueOrganizationColumn,
    id: "organization",
    width: "11rem",
  },
  {
    header: EXPLORER_LABELS.writeQueueOperationsColumn,
    id: "operations",
    width: "20rem",
  },
  {
    header: EXPLORER_LABELS.writeQueueQueuedColumn,
    id: "queued",
    width: "12rem",
  },
  {
    header: EXPLORER_LABELS.writeQueueStatusColumn,
    id: "status",
    width: "11rem",
  },
  miniAppRowActionsColumn(EXPLORER_LABELS.writeQueueRowActionsLabel),
];

const OUTGOING_COMPACT_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: EXPLORER_LABELS.writeQueueObjectColumn, id: "object" },
  {
    header: EXPLORER_LABELS.writeQueueStatusColumn,
    id: "status",
    width: "8rem",
  },
  miniAppRowActionsColumn(EXPLORER_LABELS.writeQueueRowActionsLabel),
];

/** Where a row's taps lead, and what its write-queue menu runs. */
export interface OutgoingRowActions {
  billingBlockedOrganizationId: string | null;
  containerNamesById: ReadonlyMap<string, string>;
  openContainerInfoRoute: (containerId: string) => void;
  openDocument: (localId: string, containerId: string) => void;
  openWriteQueueEntryRoute: (entryKey: string) => void;
  organizationNamesById: ReadonlyMap<string, string>;
  /** Asks to confirm; only the dialog's confirm discards. */
  requestDiscardPendingWrites: (item: PendingWriteQueueItem) => void;
  retryPendingWrites: (item: PendingWriteQueueItem) => void;
}

function getRowName(row: OutgoingRow): string {
  return row.kind === "write"
    ? getWriteQueueItemName(row.write)
    : row.upload.item.fileName;
}

// The line under the name: a queued entry's type and id, and a file's size.
function getRowIdentity(row: OutgoingRow): string {
  switch (row.kind) {
    case "file":
      return `${EXPLORER_LABELS.uploadsFileType} · ${formatByteLength(row.upload.item.fileSize)}`;
    case "file-write":
      return `${getWriteQueueItemIdentity(row.write)} · ${formatByteLength(row.upload.item.fileSize)}`;
    case "write":
      return getWriteQueueItemIdentity(row.write);
  }
}

// A queued entry opens its folder's info or its document; a file opens its
// document once it is stored and not deleted.
function getRowOpenAction(
  row: OutgoingRow,
  name: string,
  actions: OutgoingRowActions,
): ExplorerTransferOpenAction | null {
  const label = `${EXPLORER_LABELS.writeQueueOpenObjectAction}: ${name}`;
  if (row.kind === "file") {
    const { containerId, localId, status } = row.upload.item;
    return localId !== null && (status === "imported" || status === "uploaded")
      ? { label, onOpen: () => actions.openDocument(localId, containerId) }
      : null;
  }
  const { write } = row;
  if (write.objectKind === "container") {
    return {
      label,
      onOpen: () => actions.openContainerInfoRoute(write.localId),
    };
  }
  const { containerId } = write;
  return write.objectKind === "document" && containerId !== null
    ? { label, onOpen: () => actions.openDocument(write.localId, containerId) }
    : null;
}

function WriteActionsCell(params: {
  actions: OutgoingRowActions;
  /** The row's name, which a joined file takes from its upload. */
  name: string;
  write: PendingWriteQueueItem;
}) {
  const { actions, write } = params;
  const { copy } = useClipboardCopy();
  const billingBlocked = isBillingBlockedWrite(
    write,
    actions.billingBlockedOrganizationId,
  );
  return (
    <WriteQueueRowActionsCell
      entryName={params.name}
      onCopy={() =>
        copy(getWriteQueueEntryClipboardText({ billingBlocked, item: write }))
      }
      onDiscard={
        canDiscardWriteQueueItem(write)
          ? () => actions.requestDiscardPendingWrites(write)
          : null
      }
      onOpenEntryInfo={() =>
        actions.openWriteQueueEntryRoute(getWriteQueueItemKey(write))
      }
      onRetry={() => actions.retryPendingWrites(write)}
    />
  );
}

// The desktop columns only a queued entry fills: its organization, its pending
// writes, and when its oldest write was queued.
function OutgoingWriteColumns(params: {
  operations: string | null;
  organizationNamesById: ReadonlyMap<string, string>;
  write: PendingWriteQueueItem | null;
}) {
  const { write } = params;
  const organizationId = write?.organizationId ?? null;
  const queuedAt = write ? (write.createdAt ?? write.updatedAt) : null;
  return (
    <>
      <MiniAppTableCell title={organizationId ?? undefined}>
        <MiniAppTableText>
          {organizationId
            ? (params.organizationNamesById.get(organizationId) ??
              organizationId)
            : "-"}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>{params.operations ?? "-"}</MiniAppTableCell>
      <MiniAppTableCell title={queuedAt ?? undefined}>
        {formatMiniAppDateTime(queuedAt, { emptyFallback: "-" })}
      </MiniAppTableCell>
    </>
  );
}

function OutgoingTableRow(params: {
  actions: OutgoingRowActions;
  compact: boolean;
  row: OutgoingRow;
}) {
  const { actions, compact, row } = params;
  const write = row.kind === "file" ? null : row.write;
  const name = getRowName(row);
  const open = getRowOpenAction(row, name, actions);
  const operations = write
    ? getOperationsLabel(write, actions.containerNamesById)
    : null;
  return (
    <MiniAppTableRow interactive={open !== null} onActivate={open?.onOpen}>
      <ExplorerTransferNameCell
        details={[
          getRowIdentity(row),
          ...(compact && operations ? [operations] : []),
        ]}
        open={open}
        title={write ? (write.remoteId ?? write.localId) : undefined}
        transfer={row.transfer}
      >
        {name}
      </ExplorerTransferNameCell>
      {compact ? null : (
        <OutgoingWriteColumns
          operations={operations}
          organizationNamesById={actions.organizationNamesById}
          write={write}
        />
      )}
      {/* A file the user chose announces its failure, as Uploads did. */}
      <ExplorerTransferStatusCell
        announceError={row.kind !== "write"}
        transfer={row.transfer}
      />
      {write ? (
        <WriteActionsCell actions={actions} name={name} write={write} />
      ) : (
        <MiniAppTableCell />
      )}
    </MiniAppTableRow>
  );
}

/**
 * Everything waiting to leave this device, and this session's uploads, in one
 * table: a file appears once, with its write-queue menu while its document
 * has queued writes.
 */
export function ExplorerOutgoingTable(params: {
  actions: OutgoingRowActions;
  /** Shown in place of rows when there are none. */
  emptyMessage: ReactNode;
  rows: ReadonlyArray<OutgoingRow>;
}) {
  const { rows } = params;
  const compact = useRoutedLayoutTier() === "mobile";
  const columns = compact ? OUTGOING_COMPACT_COLUMNS : OUTGOING_COLUMNS;
  const [rowLimit, setRowLimit] = useState(OUTGOING_ROW_LIMIT);

  return (
    <MiniAppTableFrame className="explorer-outgoing-table mini-app-table-frame--bleed mini-app-table-frame--edges">
      <MiniAppTable
        aria-label={EXPLORER_LABELS.outgoingAction}
        columns={columns}
        style={compact ? undefined : { minWidth: "66rem" }}
      >
        {rows.slice(0, rowLimit).map((row) => (
          <OutgoingTableRow
            actions={params.actions}
            compact={compact}
            key={row.key}
            row={row}
          />
        ))}
        {rows.length === 0 ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {params.emptyMessage}
          </MiniAppTableEmptyRow>
        ) : null}
        {rows.length > rowLimit ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            <MiniAppButton
              onClick={() => setRowLimit((limit) => limit + OUTGOING_ROW_LIMIT)}
              variant="ghost"
            >
              {EXPLORER_LABELS.outgoingShowMoreAction}
            </MiniAppButton>
          </MiniAppTableEmptyRow>
        ) : null}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
