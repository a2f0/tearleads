import type { SyncLaneStatus } from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import {
  MiniAppTableCell,
  MiniAppTableText,
} from "../../../../components/mini-app/MiniAppTable";
import {
  ExplorerSyncLaneStatusBadge,
  ExplorerSyncProgressBar,
} from "../sync/ExplorerSyncLaneShared";
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

/** The row's name with its progress bar spanning the cell beneath it. */
export function ExplorerTransferNameCell(params: {
  children: ReactNode;
  title?: string | undefined;
  transfer: ExplorerTransferProgress;
}) {
  return (
    <MiniAppTableCell>
      <span className="explorer-transfer-name">
        <MiniAppTableText title={params.title}>
          {params.children}
        </MiniAppTableText>
        <ExplorerSyncProgressBar
          label={params.transfer.label}
          percent={params.transfer.percent}
          status={params.transfer.status}
        />
      </span>
    </MiniAppTableCell>
  );
}

/** The row's status badge, with its detail beneath. */
export function ExplorerTransferStatusCell(params: {
  transfer: ExplorerTransferProgress;
}) {
  const { detail, label, status } = params.transfer;
  return (
    <MiniAppTableCell>
      <span className="explorer-transfer-status">
        <ExplorerSyncLaneStatusBadge label={label} status={status} />
        {detail === null ? null : (
          <span className="explorer-sync-lane-muted" title={detail}>
            {detail}
          </span>
        )}
      </span>
    </MiniAppTableCell>
  );
}
