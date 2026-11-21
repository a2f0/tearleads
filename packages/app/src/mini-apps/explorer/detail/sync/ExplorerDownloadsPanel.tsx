import {
  type ContainerDocumentQueries,
  type ContainerNode,
  type DomainScope,
  type PendingDownloadQueueItem,
  type RetryDocumentDownloadInput,
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
import { useTearleads } from "../../../../providers/sdk/TearleadsProvider";
import { EXPLORER_LABELS, getExplorerDownloadsCountLabel } from "../../labels";
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
  if (item.objectKind === "attachment")
    return EXPLORER_LABELS.downloadsFileWaiting;
  return item.reason === "continuation"
    ? EXPLORER_LABELS.downloadsRemaining
    : EXPLORER_LABELS.downloadsWaiting;
}

function downloadItemKey(item: PendingDownloadQueueItem): string {
  return item.objectKind === "attachment"
    ? `attachment:${item.localId}:${item.slotId}`
    : `${item.objectKind}:${item.localId}`;
}

function DownloadItemLabel(params: { item: PendingDownloadQueueItem }) {
  const { item } = params;
  if (item.objectKind === "attachment") {
    return (
      <MiniAppTableText title={item.documentId}>
        {item.fileName}
        <small> {item.title}</small>
      </MiniAppTableText>
    );
  }
  return (
    <MiniAppTableText title={item.documentId}>
      {item.title ??
        (item.objectKind === "container"
          ? EXPLORER_LABELS.downloadsUnknownFolder
          : EXPLORER_LABELS.downloadsUnknownDocument)}
      <small> {item.documentId}</small>
    </MiniAppTableText>
  );
}

// A synced document only re-lists its file bindings when it pulls again, and
// its store may not be open, so a retry asks each document with a pending
// file directly. Only shown rows are retried: each opens and keeps a store.
// The request names the document id the row was read with.
function retryPendingDownloads(
  items: ReadonlyArray<PendingDownloadQueueItem>,
  retryDownload: (input: RetryDocumentDownloadInput) => Promise<boolean>,
) {
  const documents = new Map<string, string>();
  for (const item of items) {
    if (item.objectKind === "attachment")
      documents.set(item.localId, item.documentId);
  }
  for (const [localId, documentId] of documents) {
    void retryDownload({ documentId, localId }).catch(() => false);
  }
}

export function ExplorerDownloadsPanel(params: {
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  isAuthenticated: boolean;
}) {
  const { documents } = useTearleads();
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
          onClick={() => {
            requestAllDomainSyncLanes(params.domainScope);
            retryPendingDownloads(state.items.slice(0, limit), (input) =>
              documents.retryDownload(input),
            );
          }}
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
              item.objectKind === "container"
                ? undefined
                : lanes.get(`documents:${item.localId}`);
            const error = item.lastError ?? lane?.lastError;
            return (
              <MiniAppTableRow key={downloadItemKey(item)}>
                <MiniAppTableCell>
                  <DownloadItemLabel item={item} />
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText>
                    {downloadStatus(
                      item,
                      lane,
                      params.online,
                      params.isAuthenticated,
                    )}
                    {error ? <small> {error}</small> : null}
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
                {EXPLORER_LABELS.downloadsShowMoreAction}
              </MiniAppButton>
            </MiniAppTableEmptyRow>
          ) : null}
        </MiniAppTable>
      </MiniAppTableFrame>
    </MiniAppPanel>
  );
}
