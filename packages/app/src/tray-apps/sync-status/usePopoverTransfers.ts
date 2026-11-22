import { useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDomainDocumentQueries } from "../../providers/sdk/useDomainDocumentQueries";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import { getOrCreateExplorerUploadHistory } from "../../stores/explorer/explorerUploadHistory";
import type { ExplorerUploadItem } from "../../stores/explorer/explorerUploadItemMachine";
import { getOrCreatePendingDownloadQueueStore } from "../../stores/sync-queues/syncQueueStores";
import { useQueueRead } from "../../stores/sync-queues/useQueueRead";
import {
  type DownloadQueueSummary,
  summarizeDownloadQueue,
} from "./syncActivityModel";

const LOADING_DOWNLOADS: DownloadQueueSummary = { status: "loading" };

// A file still on its way to the server: queued, importing, or imported and
// awaiting its upload's confirmation.
function isUnfinishedUpload(item: ExplorerUploadItem): boolean {
  return (
    item.status === "queued" ||
    item.status === "importing" ||
    item.status === "imported"
  );
}

/**
 * What the open popover reads beyond the tray's own status: the download
 * queue, through the scope's shared store (watched only while the popover is
 * mounted, so the always-visible glyph adds no SQL), and the files the
 * Explorer is still uploading.
 */
export function usePopoverTransfers(): {
  downloads: DownloadQueueSummary;
  uploadingFileCount: number;
} {
  const runtime = useTearleadsRuntime();
  const domainScope = runtime.state.domainScope;
  const dbReady = runtime.infra.dbStatus === "ready";
  const documentQueries = useDomainDocumentQueries(runtime);
  const state = useQueueRead(
    getOrCreatePendingDownloadQueueStore(domainScope),
    dbReady ? documentQueries : null,
  );
  const downloads = useMemo(
    () => (dbReady ? summarizeDownloadQueue(state) : LOADING_DOWNLOADS),
    [dbReady, state],
  );
  const uploads = useTearleadsExternalStoreSnapshot(
    getOrCreateExplorerUploadHistory(domainScope),
  );
  const uploadingFileCount = useMemo(
    () => uploads.filter(isUnfinishedUpload).length,
    [uploads],
  );
  return { downloads, uploadingFileCount };
}
