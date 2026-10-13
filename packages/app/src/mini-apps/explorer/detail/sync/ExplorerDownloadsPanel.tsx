import {
  type ContainerDocumentQueries,
  type ContainerNode,
  type DomainScope,
  type PendingDownloadQueueItem,
  requestAllDomainSyncLanes,
  type SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { useState } from "react";
import {
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../../components/mini-app/MiniAppTable";
import { EXPLORER_LABELS } from "../../labels";
import { getExplorerDownloadsCountLabel } from "../../shared/downloadLabels";
import { useDomainSyncSnapshot } from "./useDomainSyncSnapshot";
import { usePendingDownloads } from "./usePendingDownloads";

const COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { id: "item", header: EXPLORER_LABELS.downloadsItemColumn, width: "20rem" },
  {
    id: "status",
    header: EXPLORER_LABELS.downloadsStatusColumn,
    width: "14rem",
  },
];

function downloadStatus(
  item: PendingDownloadQueueItem,
  lane: SyncLaneSnapshot | undefined,
  online: boolean,
  isAuthenticated: boolean,
): string {
  if (!isAuthenticated) return EXPLORER_LABELS.downloadsSignIn;
  if (!online) return EXPLORER_LABELS.downloadsOffline;
  if (lane?.running) return EXPLORER_LABELS.downloadsRunning;
  if (item.lastError || lane?.status === "error")
    return EXPLORER_LABELS.downloadsError;
  return item.reason === "continuation"
    ? EXPLORER_LABELS.downloadsRemaining
    : EXPLORER_LABELS.downloadsWaiting;
}

export function ExplorerDownloadsPanel(params: {
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  isAuthenticated: boolean;
}) {
  const snapshot = useDomainSyncSnapshot(params.domainScope);
  const state = usePendingDownloads({ ...params, syncSnapshot: snapshot });
  const [limit, setLimit] = useState(100);
  const lanes = new Map(snapshot.lanes.map((lane) => [lane.key, lane]));
  return (
    <MiniAppPanel className="explorer-detail explorer-detail--downloads" scroll>
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.downloadsAction}</strong>
          <span>{EXPLORER_LABELS.downloadsDescription}</span>
        </MiniAppHeaderCopy>
        <MiniAppButton
          disabled={!params.online || !params.isAuthenticated}
          onClick={() => requestAllDomainSyncLanes(params.domainScope)}
        >
          {EXPLORER_LABELS.syncLanesSyncNowAction}
        </MiniAppButton>
      </MiniAppHeader>
      {state.error ? (
        <MiniAppStatus role="alert">{state.error}</MiniAppStatus>
      ) : null}
      {!state.error ? (
        <MiniAppStatus>
          {state.loading
            ? EXPLORER_LABELS.downloadsLoading
            : getExplorerDownloadsCountLabel(state.items.length)}
        </MiniAppStatus>
      ) : null}
      <MiniAppTableFrame className="mini-app-table-frame--bleed">
        <MiniAppTable
          aria-label={EXPLORER_LABELS.downloadsAction}
          columns={COLUMNS}
        >
          {state.items.slice(0, limit).map((item) => {
            const lane =
              item.objectKind === "document"
                ? lanes.get(`documents:${item.localId}`)
                : undefined;
            const error = item.lastError ?? lane?.lastError;
            return (
              <MiniAppTableRow key={`${item.objectKind}:${item.localId}`}>
                <MiniAppTableCell>
                  <MiniAppTableText title={item.documentId}>
                    {item.title ??
                      (item.objectKind === "container"
                        ? EXPLORER_LABELS.downloadsUnknownFolder
                        : EXPLORER_LABELS.downloadsUnknownDocument)}
                    <small> {item.documentId}</small>
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText>
                    {downloadStatus(
                      item,
                      lane,
                      params.online,
                      params.isAuthenticated,
                    )}
                    {error ? <small role="alert"> {error}</small> : null}
                  </MiniAppTableText>
                </MiniAppTableCell>
              </MiniAppTableRow>
            );
          })}
          {!state.loading && !state.error && state.items.length === 0 ? (
            <MiniAppTableEmptyRow colSpan={2}>
              {EXPLORER_LABELS.downloadsEmpty}
            </MiniAppTableEmptyRow>
          ) : null}
          {state.items.length > limit ? (
            <MiniAppTableEmptyRow colSpan={2}>
              <MiniAppButton
                onClick={() => setLimit((current) => current + 100)}
              >
                {EXPLORER_LABELS.uploadsShowMoreAction}
              </MiniAppButton>
            </MiniAppTableEmptyRow>
          ) : null}
        </MiniAppTable>
      </MiniAppTableFrame>
    </MiniAppPanel>
  );
}
