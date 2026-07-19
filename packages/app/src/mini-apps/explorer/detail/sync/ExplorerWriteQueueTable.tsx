import type {
  ContainerNode,
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
} from "@tearleads/client-sdk";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MiniAppButton } from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowActionsButton,
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../../components/mini-app/MiniAppTable";
import { Menu, type MenuPosition } from "../../../../components/shared/Menu";
import { MenuItem } from "../../../../components/shared/MenuItem";
import { useRoutedLayoutTier } from "../../../../navigation/useRoutedLayoutTier";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerWriteQueueAttachmentLabel,
  getExplorerWriteQueueMetadataUpdateLabel,
  getExplorerWriteQueueUpdateLabel,
} from "../../labels";

export const WRITE_QUEUE_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  {
    header: EXPLORER_LABELS.writeQueueObjectColumn,
    id: "object",
    width: "15rem",
  },
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
    width: "8rem",
  },
];

export const WRITE_QUEUE_COMPACT_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: EXPLORER_LABELS.writeQueueObjectColumn, id: "object" },
  {
    header: EXPLORER_LABELS.writeQueueStatusColumn,
    id: "status",
    width: "8rem",
  },
];

// Appended only when a discard handler is wired, so read-only mounts (and the
// empty state) keep the plain column set.
const WRITE_QUEUE_ACTIONS_COLUMN: MiniAppTableColumn = {
  className: "mini-app-row-actions-column",
  header: (
    <span className="mini-app-row-actions-heading">
      {EXPLORER_LABELS.itemActionsColumn}
    </span>
  ),
  id: "actions",
  width: "var(--mini-app-row-actions-column-width, 2.25rem)",
};

const WRITE_QUEUE_PAGE_SIZE = 100;

function getOperationLabel(
  operation: PendingWriteQueueOperation,
  item: PendingWriteQueueItem,
  containerNamesById: ReadonlyMap<string, string>,
): string {
  if (operation.kind === "attachment") {
    return getExplorerWriteQueueAttachmentLabel(
      operation.count,
      operation.byteLength,
    );
  }
  if (operation.kind === "create") {
    return EXPLORER_LABELS.writeQueueCreateOperation;
  }
  if (operation.kind === "deferred-update") {
    return EXPLORER_LABELS.writeQueueDeferredUpdateOperation;
  }
  if (operation.kind === "move") {
    const target = operation.targetContainerId
      ? (containerNamesById.get(operation.targetContainerId) ??
        operation.targetContainerId)
      : null;
    return target
      ? `${EXPLORER_LABELS.writeQueueMoveOperation} ${EXPLORER_LABELS.writeQueueTargetPrefix} ${target}`
      : EXPLORER_LABELS.writeQueueMoveOperation;
  }

  return item.objectKind === "container"
    ? getExplorerWriteQueueMetadataUpdateLabel(operation.count)
    : getExplorerWriteQueueUpdateLabel(operation.count);
}

function getOperationsLabel(
  item: PendingWriteQueueItem,
  containerNamesById: ReadonlyMap<string, string>,
): string {
  return item.operations
    .map((operation) => getOperationLabel(operation, item, containerNamesById))
    .join(" · ");
}

function getObjectTypeLabel(
  objectKind: PendingWriteQueueItem["objectKind"],
): string {
  if (objectKind === "container") {
    return EXPLORER_LABELS.writeQueueContainerType;
  }
  if (objectKind === "document") {
    return EXPLORER_LABELS.writeQueueDocumentType;
  }
  return EXPLORER_LABELS.writeQueueUnknownObjectType;
}

function getStatusLabel(status: PendingWriteQueueItem["status"]): string {
  if (status === "error") {
    return EXPLORER_LABELS.writeQueueErrorStatus;
  }
  if (status === "blocked") {
    return EXPLORER_LABELS.writeQueueBlockedStatus;
  }
  return EXPLORER_LABELS.writeQueuePendingStatus;
}

function getWriteQueueItemName(item: PendingWriteQueueItem): string {
  const displayName = item.name?.trim() ?? "";
  return displayName.length > 0 ? displayName : item.localId;
}

function WriteQueueObjectCell(params: {
  item: PendingWriteQueueItem;
  operationLabel: string | null;
  openContainerInfoRoute: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
}) {
  const { item } = params;
  const openObject = useCallback(() => {
    if (item.objectKind === "container") {
      params.openContainerInfoRoute(item.localId);
      return;
    }
    if (item.objectKind === "document" && item.containerId) {
      params.openDocumentInfoRoute(item.localId, item.containerId);
    }
  }, [item, params.openContainerInfoRoute, params.openDocumentInfoRoute]);
  const canOpen =
    item.objectKind === "container" ||
    (item.objectKind === "document" && item.containerId !== null);
  const name = getWriteQueueItemName(item);
  const typeLabel =
    item.objectKind === "unknown" && item.namespace
      ? item.namespace
      : getObjectTypeLabel(item.objectKind);
  const content = (
    <span className="explorer-write-queue-object-copy">
      <MiniAppTableText title={name}>{name}</MiniAppTableText>
      <MiniAppTableText muted title={item.localId}>
        {typeLabel} · {item.localId}
      </MiniAppTableText>
      {params.operationLabel ? (
        <MiniAppTableText muted title={params.operationLabel}>
          {params.operationLabel}
        </MiniAppTableText>
      ) : null}
    </span>
  );

  return (
    <MiniAppTableCell title={item.remoteId ?? item.localId}>
      {canOpen ? (
        <MiniAppTableActionButton
          aria-label={`${EXPLORER_LABELS.writeQueueOpenObjectAction}: ${name}`}
          onClick={openObject}
        >
          {content}
        </MiniAppTableActionButton>
      ) : (
        content
      )}
    </MiniAppTableCell>
  );
}

function WriteQueueStatusCell(params: {
  billingBlocked: boolean;
  item: PendingWriteQueueItem;
}) {
  const error =
    params.item.operations.find((operation) => operation.lastError)
      ?.lastError ?? null;
  return (
    <MiniAppTableCell title={error ?? undefined}>
      <span className="explorer-write-queue-status-stack">
        <span
          className={`explorer-write-queue-status explorer-write-queue-status--${params.item.status}`}
        >
          {getStatusLabel(params.item.status)}
        </span>
        {params.billingBlocked && params.item.status === "pending" ? (
          <MiniAppTableText muted>
            {EXPLORER_LABELS.writeQueueBillingPaused}
          </MiniAppTableText>
        ) : error ? (
          <MiniAppTableText muted title={error}>
            {error}
          </MiniAppTableText>
        ) : null}
      </span>
    </MiniAppTableCell>
  );
}

// The row kebab: opens a small menu whose single destructive action requires a
// second, explicit confirm click before the queued write's local state is
// discarded (see the SDK's `discardPendingWrite` for what a discard entails).
function WriteQueueActionsCell(params: {
  discardPendingWrite: (item: PendingWriteQueueItem) => Promise<boolean>;
  item: PendingWriteQueueItem;
  name: string;
}) {
  const { discardPendingWrite, item } = params;
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const closeMenu = useCallback(() => {
    setMenuPosition(null);
    setConfirming(false);
  }, []);
  const toggleMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setConfirming(false);
    setMenuPosition((current) =>
      current ? null : { x: rect.left, y: rect.bottom },
    );
  }, []);
  const discard = useCallback(() => {
    setBusy(true);
    void discardPendingWrite(item).finally(() => {
      setBusy(false);
      closeMenu();
    });
  }, [closeMenu, discardPendingWrite, item]);

  return (
    <MiniAppTableCell className="mini-app-row-actions-cell">
      <MiniAppRowActionsButton
        aria-expanded={menuPosition !== null}
        aria-label={`${EXPLORER_LABELS.itemActionsButtonPrefix} ${params.name}`}
        onClick={toggleMenu}
        title={`${EXPLORER_LABELS.itemActionsButtonPrefix} ${params.name}`}
      />
      {menuPosition && (
        <Menu direction="down" onClose={closeMenu} position={menuPosition}>
          {confirming ? (
            <>
              <MenuItem
                disabled={busy}
                label={EXPLORER_LABELS.writeQueueDiscardConfirm}
                onClick={discard}
              />
              <MenuItem
                disabled={busy}
                label={EXPLORER_LABELS.writeQueueDiscardCancel}
                onClick={closeMenu}
              />
            </>
          ) : (
            <MenuItem
              label={EXPLORER_LABELS.writeQueueDiscardAction}
              onClick={() => setConfirming(true)}
            />
          )}
        </Menu>
      )}
    </MiniAppTableCell>
  );
}

interface WriteQueueTableProps {
  billingBlockedOrganizationId: string | null;
  discardPendingWrite?:
    | ((item: PendingWriteQueueItem) => Promise<boolean>)
    | undefined;
  items: ReadonlyArray<PendingWriteQueueItem>;
  nodes: ReadonlyArray<ContainerNode>;
  openContainerInfoRoute: (containerId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  organizationNamesById: ReadonlyMap<string, string>;
}

function WriteQueueRow(
  params: Omit<WriteQueueTableProps, "items" | "nodes"> & {
    compact: boolean;
    containerNamesById: ReadonlyMap<string, string>;
    item: PendingWriteQueueItem;
  },
) {
  const { item } = params;
  const organizationLabel = item.organizationId
    ? (params.organizationNamesById.get(item.organizationId) ??
      item.organizationId)
    : "-";
  const operationsLabel = getOperationsLabel(item, params.containerNamesById);

  return (
    <MiniAppTableRow>
      <WriteQueueObjectCell
        item={item}
        operationLabel={params.compact ? operationsLabel : null}
        openContainerInfoRoute={params.openContainerInfoRoute}
        openDocumentInfoRoute={params.openDocumentInfoRoute}
      />
      {params.compact ? null : (
        <>
          <MiniAppTableCell title={item.organizationId ?? undefined}>
            <MiniAppTableText>{organizationLabel}</MiniAppTableText>
          </MiniAppTableCell>
          <MiniAppTableCell>{operationsLabel}</MiniAppTableCell>
          <MiniAppTableCell
            title={item.createdAt ?? item.updatedAt ?? undefined}
          >
            {formatMiniAppDateTime(item.createdAt ?? item.updatedAt, {
              emptyFallback: "-",
            })}
          </MiniAppTableCell>
        </>
      )}
      <WriteQueueStatusCell
        billingBlocked={
          item.organizationId !== null &&
          item.organizationId === params.billingBlockedOrganizationId
        }
        item={item}
      />
      {params.discardPendingWrite ? (
        <WriteQueueActionsCell
          discardPendingWrite={params.discardPendingWrite}
          item={item}
          name={getWriteQueueItemName(item)}
        />
      ) : null}
    </MiniAppTableRow>
  );
}

export function ExplorerWriteQueueTable(params: WriteQueueTableProps) {
  const compact = useRoutedLayoutTier() === "mobile";
  const containerNamesById = useMemo(
    () => new Map(params.nodes.map((node) => [node.id, node.name])),
    [params.nodes],
  );
  const baseColumns = compact
    ? WRITE_QUEUE_COMPACT_COLUMNS
    : WRITE_QUEUE_COLUMNS;
  const columns = params.discardPendingWrite
    ? [...baseColumns, WRITE_QUEUE_ACTIONS_COLUMN]
    : baseColumns;
  const [visibleCount, setVisibleCount] = useState(WRITE_QUEUE_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(WRITE_QUEUE_PAGE_SIZE);
  }, [params.items]);
  const visibleItems = params.items.slice(0, visibleCount);

  return (
    <>
      <MiniAppTableFrame className="explorer-write-queue-table-wrap">
        <MiniAppTable
          aria-label={EXPLORER_LABELS.writeQueueTitle}
          columns={columns}
          style={compact ? undefined : { minWidth: "66rem" }}
        >
          {visibleItems.map((item) => (
            <WriteQueueRow
              billingBlockedOrganizationId={params.billingBlockedOrganizationId}
              compact={compact}
              containerNamesById={containerNamesById}
              discardPendingWrite={params.discardPendingWrite}
              item={item}
              key={`${item.objectKind}:${item.namespace ?? ""}:${item.localId}`}
              openContainerInfoRoute={params.openContainerInfoRoute}
              openDocumentInfoRoute={params.openDocumentInfoRoute}
              organizationNamesById={params.organizationNamesById}
            />
          ))}
        </MiniAppTable>
      </MiniAppTableFrame>
      {visibleCount < params.items.length ? (
        <div className="explorer-write-queue-more">
          <MiniAppButton
            onClick={() => {
              setVisibleCount((current) => current + WRITE_QUEUE_PAGE_SIZE);
            }}
          >
            {EXPLORER_LABELS.writeQueueShowMoreAction}
          </MiniAppButton>
        </div>
      ) : null}
    </>
  );
}
