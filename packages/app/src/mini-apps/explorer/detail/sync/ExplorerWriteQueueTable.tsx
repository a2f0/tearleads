import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
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
  miniAppRowActionsColumn,
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
  miniAppRowActionsColumn(EXPLORER_LABELS.writeQueueRowActionsLabel),
];

export const WRITE_QUEUE_COMPACT_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: EXPLORER_LABELS.writeQueueObjectColumn, id: "object" },
  {
    header: EXPLORER_LABELS.writeQueueStatusColumn,
    id: "status",
    width: "8rem",
  },
  miniAppRowActionsColumn(EXPLORER_LABELS.writeQueueRowActionsLabel),
];

const WRITE_QUEUE_PAGE_SIZE = 100;

export function getOperationLabel(
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

export function getObjectTypeLabel(
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

export function getStatusLabel(
  status: PendingWriteQueueItem["status"],
): string {
  if (status === "error") {
    return EXPLORER_LABELS.writeQueueErrorStatus;
  }
  if (status === "blocked") {
    return EXPLORER_LABELS.writeQueueBlockedStatus;
  }
  return EXPLORER_LABELS.writeQueuePendingStatus;
}

export function getWriteQueueItemName(item: PendingWriteQueueItem): string {
  const displayName = item.name?.trim() ?? "";
  return displayName.length > 0 ? displayName : item.localId;
}

// The entry's full identity: pending writes are grouped by
// (objectKind, namespace, localId), so a localId alone can be ambiguous (e.g.
// two unrecognized namespaces). This same key backs the row key, the detail
// route, and the detail lookup so they can never disagree about which entry is
// meant.
export function getWriteQueueItemKey(item: PendingWriteQueueItem): string {
  return `${item.objectKind}:${item.namespace ?? ""}:${item.localId}`;
}

function WriteQueueObjectCell(params: {
  canOpen: boolean;
  item: PendingWriteQueueItem;
  onOpenObject: () => void;
  operationLabel: string | null;
}) {
  const { canOpen, item } = params;
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
          onClick={params.onOpenObject}
        >
          {content}
        </MiniAppTableActionButton>
      ) : (
        content
      )}
    </MiniAppTableCell>
  );
}

// The row's overflow ("kebab") menu. Its one action drills into the write-queue
// entry detail — a diagnostics view that surfaces why the change is still
// queued. Kept separate from the row's primary tap (which opens the object) so
// inspecting a stuck write never navigates away to the document.
function WriteQueueRowActionsCell(params: {
  entryName: string;
  onOpenEntryInfo: () => void;
  onRetry: () => void;
}) {
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const closeMenu = useCallback(() => setMenuPosition(null), []);
  const toggleMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setMenuPosition((current) => {
      if (current !== null) {
        return null;
      }
      // Anchor to the button's box (not the pointer) so keyboard activation,
      // which reports 0,0 client coordinates, still opens the menu under it.
      const rect = event.currentTarget.getBoundingClientRect();
      return { x: rect.left, y: rect.bottom };
    });
  }, []);
  // Name the entry in the trigger so a screen reader reading a column of
  // otherwise-identical kebabs can tell which row's actions each one opens.
  const label = `${EXPLORER_LABELS.writeQueueRowActionsLabel}: ${params.entryName}`;

  return (
    <MiniAppTableCell className="mini-app-row-actions-cell">
      <MiniAppRowActionsButton
        aria-expanded={menuPosition !== null}
        aria-label={label}
        onClick={toggleMenu}
        // Keep the trigger's mousedown from reaching the Menu's document-level
        // outside-click handler, so re-clicking the trigger can toggle it shut.
        onMouseDown={(event) => event.stopPropagation()}
        title={label}
      />
      {menuPosition ? (
        <Menu direction="down" onClose={closeMenu} position={menuPosition}>
          <MenuItem
            icon={InfoIcon}
            label={EXPLORER_LABELS.writeQueueEntryInfoAction}
            onClick={() => {
              closeMenu();
              params.onOpenEntryInfo();
            }}
          />
          <MenuItem
            icon={ArrowsClockwiseIcon}
            label={EXPLORER_LABELS.writeQueueRetryAction}
            onClick={() => {
              closeMenu();
              params.onRetry();
            }}
          />
        </Menu>
      ) : null}
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

interface WriteQueueTableProps {
  billingBlockedOrganizationId: string | null;
  items: ReadonlyArray<PendingWriteQueueItem>;
  nodes: ReadonlyArray<ContainerNode>;
  openContainerInfoRoute: (containerId: string) => void;
  openDocument: (localId: string, containerId: string) => void;
  openWriteQueueEntryRoute: (entryKey: string) => void;
  organizationNamesById: ReadonlyMap<string, string>;
  retryPendingWrites: (item: PendingWriteQueueItem) => void;
}

function WriteQueueRow(
  params: Omit<WriteQueueTableProps, "items" | "nodes"> & {
    compact: boolean;
    containerNamesById: ReadonlyMap<string, string>;
    item: PendingWriteQueueItem;
  },
) {
  const { item } = params;
  const { openContainerInfoRoute, openDocument } = params;
  const openObject = useCallback(() => {
    if (item.objectKind === "container") {
      openContainerInfoRoute(item.localId);
      return;
    }
    if (item.objectKind === "document" && item.containerId) {
      openDocument(item.localId, item.containerId);
    }
  }, [item, openContainerInfoRoute, openDocument]);
  const canOpen =
    item.objectKind === "container" ||
    (item.objectKind === "document" && item.containerId !== null);
  const organizationLabel = item.organizationId
    ? (params.organizationNamesById.get(item.organizationId) ??
      item.organizationId)
    : "-";
  const operationsLabel = getOperationsLabel(item, params.containerNamesById);

  return (
    <MiniAppTableRow
      interactive={canOpen}
      onActivate={canOpen ? openObject : undefined}
    >
      <WriteQueueObjectCell
        canOpen={canOpen}
        item={item}
        onOpenObject={openObject}
        operationLabel={params.compact ? operationsLabel : null}
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
      <WriteQueueRowActionsCell
        entryName={getWriteQueueItemName(item)}
        onOpenEntryInfo={() =>
          params.openWriteQueueEntryRoute(getWriteQueueItemKey(item))
        }
        onRetry={() => params.retryPendingWrites(item)}
      />
    </MiniAppTableRow>
  );
}

export function ExplorerWriteQueueTable(params: WriteQueueTableProps) {
  const compact = useRoutedLayoutTier() === "mobile";
  const containerNamesById = useMemo(
    () => new Map(params.nodes.map((node) => [node.id, node.name])),
    [params.nodes],
  );
  const columns = compact ? WRITE_QUEUE_COMPACT_COLUMNS : WRITE_QUEUE_COLUMNS;
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
              item={item}
              key={getWriteQueueItemKey(item)}
              openContainerInfoRoute={params.openContainerInfoRoute}
              openDocument={params.openDocument}
              openWriteQueueEntryRoute={params.openWriteQueueEntryRoute}
              organizationNamesById={params.organizationNamesById}
              retryPendingWrites={params.retryPendingWrites}
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
