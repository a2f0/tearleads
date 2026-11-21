import type { SyncLaneStatus } from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import {
  MiniAppTableActionButton,
  MiniAppTableCell,
  MiniAppTableText,
} from "../../../../components/mini-app/MiniAppTable";
import {
  ExplorerSyncLaneStatusBadge,
  ExplorerSyncProgressBar,
} from "../sync/ExplorerSyncLaneShared";
import { getExplorerSyncLaneProgress } from "../sync/ExplorerSyncLaneUtils";
import "./ExplorerTransferCells.css";

/**
 * How one transfer row reads: its wording, the Sync Lanes tone that
 * colors its bar and badge, how full the bar is, and an optional detail such
 * as an error.
 */
export interface ExplorerTransferProgress {
  detail: string | null;
  label: string;
  percent: number;
  status: SyncLaneStatus;
}

/**
 * The Sync Lanes fill for a transfer without byte counts. A failed transfer
 * keeps the queued fill, so only a Complete one reaches 100%.
 */
export function getExplorerTransferStatusPercent(
  status: SyncLaneStatus,
): number {
  return getExplorerSyncLaneProgress(status === "error" ? "queued" : status);
}

/** Where a finished transfer's row leads, and the accessible name for it. */
export interface ExplorerTransferOpenAction {
  label: string;
  onOpen: () => void;
}

/**
 * The row's name with its progress bar spanning the cell beneath it. With an
 * `open` action the name is the row's keyboard-reachable link; pair it with
 * `MiniAppTableRow`'s `onActivate` so a click anywhere on the row follows it.
 */
export function ExplorerTransferNameCell(params: {
  children: ReactNode;
  open?: ExplorerTransferOpenAction | null | undefined;
  title?: string | undefined;
  transfer: ExplorerTransferProgress;
}) {
  const name = (
    <MiniAppTableText title={params.title}>{params.children}</MiniAppTableText>
  );
  return (
    <MiniAppTableCell>
      <span className="explorer-transfer-name">
        {params.open ? (
          <MiniAppTableActionButton
            aria-label={params.open.label}
            onClick={params.open.onOpen}
          >
            {name}
          </MiniAppTableActionButton>
        ) : (
          name
        )}
        <ExplorerSyncProgressBar
          label={params.transfer.label}
          percent={params.transfer.percent}
          status={params.transfer.status}
        />
      </span>
    </MiniAppTableCell>
  );
}

/**
 * The row's status badge, with its detail beneath. `announceError` makes an
 * error badge a live alert, for a list of files the user chose themselves.
 */
export function ExplorerTransferStatusCell(params: {
  announceError?: boolean;
  transfer: ExplorerTransferProgress;
}) {
  const { detail, label, status } = params.transfer;
  const badge = <ExplorerSyncLaneStatusBadge label={label} status={status} />;
  return (
    <MiniAppTableCell>
      <span className="explorer-transfer-status">
        {params.announceError && status === "error" ? (
          <span role="alert">{badge}</span>
        ) : (
          badge
        )}
        {detail === null ? null : (
          <span className="explorer-sync-lane-muted" title={detail}>
            {detail}
          </span>
        )}
      </span>
    </MiniAppTableCell>
  );
}
