import type {
  ContainerDocumentQueries,
  ContainerNode,
  DomainScope,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { useEffect, useState } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
} from "../../../../components/mini-app/MiniAppTable";
import { useRoutedLayoutTier } from "../../../../navigation/useRoutedLayoutTier";
import {
  EXPLORER_LABELS,
  getExplorerWriteQueueSummaryLabel,
} from "../../labels";
import {
  ExplorerWriteQueueTable,
  WRITE_QUEUE_COLUMNS,
  WRITE_QUEUE_COMPACT_COLUMNS,
} from "./ExplorerWriteQueueTable";
import { useDomainSyncSnapshot } from "./useDomainSyncSnapshot";
import "./ExplorerWriteQueuePanel.css";

interface ExplorerWriteQueuePanelProps {
  billingBlockedOrganizationId: string | null;
  discardPendingWrite?:
    | ((item: PendingWriteQueueItem) => Promise<boolean>)
    | undefined;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  isAuthenticated: boolean;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  openContainerInfoRoute: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  organizationNamesById: ReadonlyMap<string, string>;
}

interface ExplorerWriteQueuePanelViewProps
  extends Omit<
    ExplorerWriteQueuePanelProps,
    "documentListRevision" | "documentQueries" | "domainScope"
  > {
  error: boolean;
  items: ReadonlyArray<PendingWriteQueueItem>;
  loading: boolean;
}

function WriteQueueBlockers(params: {
  billingBlockedOrganizationId: string | null;
  isAuthenticated: boolean;
  online: boolean;
  organizationNamesById: ReadonlyMap<string, string>;
}) {
  const messages: string[] = [];
  if (!params.online) {
    messages.push(EXPLORER_LABELS.writeQueueWaitingForNetwork);
  }
  if (!params.isAuthenticated) {
    messages.push(EXPLORER_LABELS.writeQueueSignedOut);
  }
  if (params.billingBlockedOrganizationId) {
    const organization =
      params.organizationNamesById.get(params.billingBlockedOrganizationId) ??
      params.billingBlockedOrganizationId;
    messages.push(
      `${EXPLORER_LABELS.writeQueueBillingPausedMessage} ${organization}.`,
    );
  }
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="explorer-write-queue-blockers" role="status">
      {messages.join(" ")}
    </div>
  );
}

function WriteQueueEmptyState(params: { error: boolean; loading: boolean }) {
  const compact = useRoutedLayoutTier() === "mobile";
  const columns = compact ? WRITE_QUEUE_COMPACT_COLUMNS : WRITE_QUEUE_COLUMNS;
  const label = params.loading
    ? EXPLORER_LABELS.writeQueueLoading
    : params.error
      ? EXPLORER_LABELS.writeQueueFailedToLoad
      : EXPLORER_LABELS.writeQueueEmpty;
  return (
    <MiniAppTableFrame>
      <MiniAppTable
        aria-label={EXPLORER_LABELS.writeQueueTitle}
        columns={columns}
      >
        <MiniAppTableEmptyRow colSpan={columns.length}>
          <span role={params.error ? "alert" : "status"}>{label}</span>
        </MiniAppTableEmptyRow>
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

export function ExplorerWriteQueuePanelView(
  params: ExplorerWriteQueuePanelViewProps,
) {
  const writeCount = params.items.reduce(
    (total, item) =>
      total +
      item.operations.reduce(
        (operationTotal, operation) => operationTotal + operation.count,
        0,
      ),
    0,
  );
  const summary = getExplorerWriteQueueSummaryLabel({
    objectCount: params.items.length,
    writeCount,
  });
  const subtitle =
    params.loading && params.items.length === 0
      ? EXPLORER_LABELS.writeQueueSummaryLoading
      : params.error
        ? EXPLORER_LABELS.writeQueueSummaryUnavailable
        : summary;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--write-queue"
      scroll
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.writeQueueTitle}</strong>
          <span>{subtitle}</span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      <WriteQueueBlockers
        billingBlockedOrganizationId={params.billingBlockedOrganizationId}
        isAuthenticated={params.isAuthenticated}
        online={params.online}
        organizationNamesById={params.organizationNamesById}
      />
      {params.error || params.items.length === 0 ? (
        <WriteQueueEmptyState error={params.error} loading={params.loading} />
      ) : (
        <ExplorerWriteQueueTable
          billingBlockedOrganizationId={params.billingBlockedOrganizationId}
          discardPendingWrite={params.discardPendingWrite}
          items={params.items}
          nodes={params.nodes}
          openContainerInfoRoute={params.openContainerInfoRoute}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
          organizationNamesById={params.organizationNamesById}
        />
      )}
    </MiniAppPanel>
  );
}

export function ExplorerWriteQueuePanel(params: ExplorerWriteQueuePanelProps) {
  const syncSnapshot = useDomainSyncSnapshot(params.domainScope);
  const syncSettlementRevision = syncSnapshot.lanes
    .map(
      (lane) =>
        `${lane.key}:${lane.runCount}:${lane.running}:${lane.lastCompletedAt ?? ""}:${lane.lastFailedAt ?? ""}`,
    )
    .join("\0");
  const [state, setState] = useState<{
    error: boolean;
    items: ReadonlyArray<PendingWriteQueueItem>;
    loading: boolean;
  }>({ error: false, items: [], loading: true });

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, error: false, loading: true }));
    void params.documentQueries.listPendingWrites().then(
      (items) => {
        if (active) {
          setState({ error: false, items, loading: false });
        }
      },
      () => {
        if (active) {
          setState({ error: true, items: [], loading: false });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [
    params.documentListRevision,
    params.documentQueries,
    params.nodes,
    syncSnapshot.hasPendingWork,
    syncSettlementRevision,
  ]);

  return (
    <ExplorerWriteQueuePanelView
      billingBlockedOrganizationId={params.billingBlockedOrganizationId}
      discardPendingWrite={params.discardPendingWrite}
      error={state.error}
      isAuthenticated={params.isAuthenticated}
      items={state.items}
      loading={state.loading}
      nodes={params.nodes}
      online={params.online}
      openContainerInfoRoute={params.openContainerInfoRoute}
      openDocumentInfoRoute={params.openDocumentInfoRoute}
      organizationNamesById={params.organizationNamesById}
    />
  );
}
