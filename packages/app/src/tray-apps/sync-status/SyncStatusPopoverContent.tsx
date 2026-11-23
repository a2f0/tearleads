import { requestAllDomainSyncLanes } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useAppNavigationActions } from "../../navigation/AppNavigationProvider";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDomainDocumentQueries } from "../../providers/sdk/useDomainDocumentQueries";
import { SyncStatusPopoverBody } from "./SyncStatusPopoverBody";
import { usePopoverTransfers } from "./usePopoverTransfers";
import type { SyncStatusResult } from "./useSyncStatus";

/**
 * The open popover: reads what only it shows (the download queue and the
 * Explorer's file uploads) and hands the body its actions' effects. A sync
 * request can run only online, signed in, with the database open.
 */
export function SyncStatusPopoverContent({
  close,
  sync,
}: {
  close: () => void;
  sync: SyncStatusResult;
}) {
  const runtime = useTearleadsRuntime();
  const { openMiniApp } = useAppNavigationActions();
  const domainScope = runtime.state.domainScope;
  const dbReady = runtime.infra.dbStatus === "ready";
  const documentQueries = useDomainDocumentQueries(runtime);
  const { downloads, uploadingFileCount } = usePopoverTransfers({
    dbReady,
    documentQueries,
    domainScope,
  });
  const syncNow = useCallback(
    () => requestAllDomainSyncLanes(domainScope),
    [domainScope],
  );
  return (
    <SyncStatusPopoverBody
      canSync={dbReady && runtime.state.online && runtime.auth.isAuthenticated}
      downloads={downloads}
      onClose={close}
      onOpenView={openMiniApp}
      onSyncNow={syncNow}
      sync={sync}
      uploadingFileCount={uploadingFileCount}
    />
  );
}
