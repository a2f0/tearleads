import type {
  ContainerDocumentQueries,
  DomainScope,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import { getOrCreateExplorerUploadHistory } from "../../stores/explorer/explorerUploadHistory";
import type { ExplorerUploadItem } from "../../stores/explorer/explorerUploadItemMachine";
import { getOrCreatePendingDownloadQueueStore } from "../../stores/sync-queues/syncQueueStores";
import { useQueueRead } from "../../stores/sync-queues/useQueueRead";
import {
  type DownloadQueueSummary,
  summarizeDownloadQueue,
} from "./syncActivityModel";

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
 * mounted and the database is open, so the always-visible glyph adds no SQL),
 * and the files the Explorer is still uploading.
 */
export function usePopoverTransfers(input: {
  dbReady: boolean;
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
}): {
  downloads: DownloadQueueSummary;
  uploadingFileCount: number;
} {
  const state = useQueueRead(
    getOrCreatePendingDownloadQueueStore(input.domainScope),
    input.dbReady ? input.documentQueries : null,
  );
  const downloads = useMemo(() => summarizeDownloadQueue(state), [state]);
  const uploads = useTearleadsExternalStoreSnapshot(
    getOrCreateExplorerUploadHistory(input.domainScope),
  );
  const uploadingFileCount = useMemo(
    () => uploads.filter(isUnfinishedUpload).length,
    [uploads],
  );
  return { downloads, uploadingFileCount };
}
