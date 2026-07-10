import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
  ContainerNode,
  DomainScope,
} from "@tearleads/client-sdk";
import { type ReactNode, useMemo } from "react";
import { MiniAppSidebar } from "../../../components/shared/MiniAppLayout";
import { useRegisteredWindowSidebar } from "../../../components/window/WindowSidebarContext";
import { useCompactRoutedMode } from "../../../navigation/useCompactRoutedMode";
import type { ExplorerBlobPickTarget } from "../blob-pick/ExplorerBlobPickProvider";
import { ExplorerDatabaseErrorStatus } from "../ExplorerDatabaseErrorStatus";
import type { ExplorerRoute } from "../routes";
import { ExplorerCompactTabs } from "./ExplorerCompactTabs";

interface ExplorerCompactSidebarPanelParams {
  blobPickTarget: ExplorerBlobPickTarget | null;
  blobStore: BlobStore;
  databaseError: boolean;
  domainScope: DomainScope;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  nodes: ReadonlyArray<ContainerNode>;
  onCancelBlobPick: () => void;
  onOpenSyncLaneDetailRoute: (laneKey: string) => void;
  onPickBlob: (blob: BlobInfo) => void;
  onRetryDatabase: () => void;
  online: boolean;
  openBlobBrowserRoute: (input?: {
    blobId?: string | null | undefined;
    storageKey?: string | null | undefined;
  }) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openSyncLanesRoute: () => void;
  route: ExplorerRoute;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
  setSidebar: (sidebar: ReactNode) => void;
}

export function useExplorerCompactSidebarPanel(
  params: ExplorerCompactSidebarPanelParams,
) {
  const compact = useCompactRoutedMode();
  const sidebar = useMemo(
    () => (
      <MiniAppSidebar className="explorer-compact-sidebar">
        {params.databaseError ? (
          <ExplorerDatabaseErrorStatus onRetry={params.onRetryDatabase} />
        ) : (
          <ExplorerCompactTabs
            blobPickTarget={params.blobPickTarget}
            blobStore={params.blobStore}
            domainScope={params.domainScope}
            loadBlobInfo={params.loadBlobInfo}
            nodes={params.nodes}
            onCancelBlobPick={params.onCancelBlobPick}
            onOpenSyncLaneDetailRoute={params.onOpenSyncLaneDetailRoute}
            onPickBlob={params.onPickBlob}
            online={params.online}
            openBlobBrowserRoute={params.openBlobBrowserRoute}
            openDocumentInfoRoute={params.openDocumentInfoRoute}
            openSyncLanesRoute={params.openSyncLanesRoute}
            route={params.route}
            selectDocumentProjection={params.selectDocumentProjection}
          />
        )}
      </MiniAppSidebar>
    ),
    [
      params.blobPickTarget,
      params.blobStore,
      params.databaseError,
      params.domainScope,
      params.loadBlobInfo,
      params.nodes,
      params.onCancelBlobPick,
      params.onOpenSyncLaneDetailRoute,
      params.onPickBlob,
      params.onRetryDatabase,
      params.online,
      params.openBlobBrowserRoute,
      params.openDocumentInfoRoute,
      params.openSyncLanesRoute,
      params.route,
      params.selectDocumentProjection,
    ],
  );

  useRegisteredWindowSidebar({
    enabled: compact,
    setSidebar: params.setSidebar,
    sidebar,
  });
}
