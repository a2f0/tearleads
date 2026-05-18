import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MiniAppRow } from "../../../components/shared/MiniAppRow";
import {
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
} from "../../../components/shared/MiniAppTable";
import type { DocumentSummary } from "../../../data/documentSummary";
import {
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "../../../data/documents/documentKinds";
import {
  DOCUMENT_TYPE_DEFINITIONS,
  getDocumentTypeDefinition,
} from "../../../document-types/registry";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../../stores/explorer/containerInfo";
import type {
  ExplorerContainerItemRow,
  ExplorerContainerItemSort,
  ExplorerContainerItemSortDirection,
  ExplorerContainerItemSortKey,
  ExplorerDocumentReadModel,
} from "../../../stores/explorer/documentReadModel";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS, getExplorerItemTableLabel } from "../labels";
import type { ExplorerRoute } from "../routes";
import type { ContainerNode } from "../types";
import { ExplorerContainerInfoPanel } from "./ExplorerContainerInfoPanel";

const EXPLORER_VIRTUAL_ROW_HEIGHT = 36;
const EXPLORER_VIRTUAL_OVERSCAN_ROWS = 8;
const EXPLORER_VIRTUAL_MIN_WINDOW_ROWS = 24;

function getSortAria(
  sort: ExplorerContainerItemSort,
  key: ExplorerContainerItemSortKey,
): MiniAppTableColumn["ariaSort"] {
  if (sort.key !== key) {
    return "none";
  }

  return sort.direction === "asc" ? "ascending" : "descending";
}

function getNextExplorerItemSort(
  currentSort: ExplorerContainerItemSort,
  key: ExplorerContainerItemSortKey,
): ExplorerContainerItemSort {
  if (currentSort.key === key) {
    return {
      direction: currentSort.direction === "asc" ? "desc" : "asc",
      key,
    };
  }

  return {
    direction: key === "type" ? "asc" : "desc",
    key,
  };
}

function ExplorerSortableTableHeader(params: {
  activeDirection: ExplorerContainerItemSortDirection | null;
  label: string;
  onClick: () => void;
}) {
  const { activeDirection, label, onClick } = params;

  return (
    <button
      type="button"
      className="explorer-table-sort-button"
      onClick={onClick}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="explorer-table-sort-indicator">
        {activeDirection === "asc"
          ? "^"
          : activeDirection === "desc"
            ? "v"
            : ""}
      </span>
    </button>
  );
}

function getExplorerItemTableColumns(params: {
  onSort: (key: ExplorerContainerItemSortKey) => void;
  sort: ExplorerContainerItemSort;
}): ReadonlyArray<MiniAppTableColumn> {
  const { onSort, sort } = params;
  const sortableHeader = (key: ExplorerContainerItemSortKey, label: string) => (
    <ExplorerSortableTableHeader
      activeDirection={sort.key === key ? sort.direction : null}
      label={label}
      onClick={() => onSort(key)}
    />
  );

  return [
    {
      id: "name",
      header: EXPLORER_LABELS.itemNameColumn,
      width: "40%",
    },
    {
      ariaSort: getSortAria(sort, "type"),
      id: "type",
      header: sortableHeader("type", EXPLORER_LABELS.itemTypeColumn),
      width: "8rem",
    },
    {
      ariaSort: getSortAria(sort, "created"),
      id: "created",
      header: sortableHeader("created", EXPLORER_LABELS.dateCreatedColumn),
      width: "11rem",
    },
    {
      ariaSort: getSortAria(sort, "modified"),
      id: "modified",
      header: sortableHeader("modified", EXPLORER_LABELS.dateModifiedColumn),
      width: "11rem",
    },
  ];
}

function getDocumentSummaryKind(
  documentSummary: Pick<DocumentSummary, "documentKind">,
): StoredDocumentKind {
  return documentSummary.documentKind ?? "note";
}

interface LinkedContainerDetail {
  id: string;
  isActive: boolean;
  label: string;
}

function getLinkedContainerDetails(
  nodes: ReadonlyArray<ContainerNode>,
  linkedContainerIds: ReadonlyArray<string>,
  activeContainerId: string | null,
): ReadonlyArray<LinkedContainerDetail> {
  return linkedContainerIds.map((linkedContainerId) => {
    const linkedContainer = nodes.find((node) => node.id === linkedContainerId);

    return {
      id: linkedContainerId,
      isActive: linkedContainerId === activeContainerId,
      label: linkedContainer?.name ?? linkedContainerId,
    };
  });
}

function ExplorerDocumentDetailActions(params: {
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  selectedDocument: DocumentSummary;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    canLinkSelectedDocument,
    canMoveSelectedDocument,
    openLinkDocumentModal,
    openMoveDocumentModal,
    selectedDocument,
    setSelectedId,
  } = params;

  return (
    <div className="explorer-detail-actions">
      <button
        type="button"
        className="explorer-action-button"
        onClick={() => {
          if (selectedDocument.containerId) {
            setSelectedId(selectedDocument.containerId);
          }
        }}
      >
        Back to Container
      </button>
      <button
        type="button"
        className="explorer-action-button"
        disabled={!canLinkSelectedDocument}
        onClick={() => {
          openLinkDocumentModal(selectedDocument.id);
        }}
      >
        Link
      </button>
      <button
        type="button"
        className="explorer-action-button"
        disabled={!canMoveSelectedDocument}
        onClick={() => {
          openMoveDocumentModal(selectedDocument.id);
        }}
      >
        Move
      </button>
    </div>
  );
}

async function handleActivateLinkedContainer(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setActivatingContainerId: (containerId: string | null) => void;
}) {
  const {
    activateLinkedContainer,
    linkedContainer,
    selectedDocumentId,
    setActionError,
    setActivatingContainerId,
  } = params;

  setActionError(null);
  setActivatingContainerId(linkedContainer.id);
  try {
    const activatedDocument = await activateLinkedContainer(
      selectedDocumentId,
      linkedContainer.id,
    );
    if (!activatedDocument) {
      setActionError(`Failed to make ${linkedContainer.label} active.`);
    }
  } catch {
    setActionError(`Failed to make ${linkedContainer.label} active.`);
  } finally {
    setActivatingContainerId(null);
  }
}

async function handleDetachLinkedContainer(params: {
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setUnlinkingContainerId: (containerId: string | null) => void;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const {
    linkedContainer,
    selectedDocumentId,
    setActionError,
    setUnlinkingContainerId,
    unlinkDocument,
  } = params;

  setActionError(null);
  setUnlinkingContainerId(linkedContainer.id);
  try {
    const unlinkedDocument = await unlinkDocument(
      selectedDocumentId,
      linkedContainer.id,
    );
    if (!unlinkedDocument) {
      setActionError(`Failed to detach ${linkedContainer.label}.`);
    }
  } catch {
    setActionError(`Failed to detach ${linkedContainer.label}.`);
  } finally {
    setUnlinkingContainerId(null);
  }
}

function ExplorerLinkedContainerRow(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  activatingContainerId: string | null;
  canActivateSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setActivatingContainerId: (containerId: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setUnlinkingContainerId: (containerId: string | null) => void;
  unlinkingContainerId: string | null;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const {
    activateLinkedContainer,
    activatingContainerId,
    canActivateSelectedDocument,
    canUnlinkSelectedDocument,
    linkedContainer,
    selectedDocumentId,
    setActionError,
    setActivatingContainerId,
    setSelectedId,
    setUnlinkingContainerId,
    unlinkingContainerId,
    unlinkDocument,
  } = params;

  return (
    <MiniAppRow
      as="li"
      className="explorer-linked-container-row"
      variant="framed"
    >
      <button
        type="button"
        className="explorer-linked-container-button"
        aria-label={`Open linked container ${linkedContainer.label}`}
        onClick={() => {
          setSelectedId(linkedContainer.id);
        }}
      >
        {linkedContainer.label}
      </button>
      <div className="explorer-linked-container-actions">
        {linkedContainer.isActive ? (
          <span className="explorer-linked-container-badge">Active</span>
        ) : (
          <button
            type="button"
            className="explorer-action-button"
            aria-label={`Make linked container ${linkedContainer.label} active`}
            disabled={
              !canActivateSelectedDocument ||
              activatingContainerId !== null ||
              unlinkingContainerId !== null
            }
            onClick={() => {
              if (
                activatingContainerId !== null ||
                unlinkingContainerId !== null
              ) {
                return;
              }

              void handleActivateLinkedContainer({
                activateLinkedContainer,
                linkedContainer,
                selectedDocumentId,
                setActionError,
                setActivatingContainerId,
              });
            }}
          >
            {activatingContainerId === linkedContainer.id
              ? "Activating..."
              : "Make Active"}
          </button>
        )}
        <button
          type="button"
          className="explorer-action-button"
          aria-label={`Detach linked container ${linkedContainer.label}`}
          disabled={
            !canUnlinkSelectedDocument ||
            activatingContainerId !== null ||
            unlinkingContainerId !== null
          }
          onClick={() => {
            if (
              activatingContainerId !== null ||
              unlinkingContainerId !== null
            ) {
              return;
            }

            void handleDetachLinkedContainer({
              linkedContainer,
              selectedDocumentId,
              setActionError,
              setUnlinkingContainerId,
              unlinkDocument,
            });
          }}
        >
          {unlinkingContainerId === linkedContainer.id
            ? "Detaching..."
            : "Detach"}
        </button>
      </div>
    </MiniAppRow>
  );
}

function ExplorerLinkedContainerSection(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocument: DocumentSummary;
  setSelectedId: (id: string | null) => void;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const {
    activateLinkedContainer,
    canActivateSelectedDocument,
    canUnlinkSelectedDocument,
    linkedContainerIds,
    nodes,
    selectedDocument,
    setSelectedId,
    unlinkDocument,
  } = params;
  const [activatingContainerId, setActivatingContainerId] = useState<
    string | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unlinkingContainerId, setUnlinkingContainerId] = useState<
    string | null
  >(null);
  const linkedContainers = getLinkedContainerDetails(
    nodes,
    linkedContainerIds,
    selectedDocument.containerId,
  );

  return (
    <div className="explorer-linked-container-section">
      <strong>Linked Containers</strong>
      <ul className="explorer-linked-container-list">
        {linkedContainers.map((linkedContainer) => (
          <ExplorerLinkedContainerRow
            activateLinkedContainer={activateLinkedContainer}
            activatingContainerId={activatingContainerId}
            canActivateSelectedDocument={canActivateSelectedDocument}
            canUnlinkSelectedDocument={canUnlinkSelectedDocument}
            key={linkedContainer.id}
            linkedContainer={linkedContainer}
            selectedDocumentId={selectedDocument.id}
            setActionError={setActionError}
            setActivatingContainerId={setActivatingContainerId}
            setSelectedId={setSelectedId}
            setUnlinkingContainerId={setUnlinkingContainerId}
            unlinkingContainerId={unlinkingContainerId}
            unlinkDocument={unlinkDocument}
          />
        ))}
      </ul>
      {actionError ? (
        <span className="explorer-detail-error">{actionError}</span>
      ) : null}
    </div>
  );
}

function ExplorerDocumentDetail(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  nodes: ReadonlyArray<ContainerNode>;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  refreshError: string | null;
  selectedDocument: DocumentSummary;
  setSelectedId: (id: string | null) => void;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const selectedDocumentKind = getDocumentSummaryKind(params.selectedDocument);
  const selectedDocumentContainer = params.selectedDocument.containerId
    ? params.nodes.find(
        (node) => node.id === params.selectedDocument.containerId,
      )
    : null;
  const SelectedDocumentApp =
    getDocumentTypeDefinition(selectedDocumentKind).App;

  return (
    <div
      className="explorer-detail explorer-detail--note"
      key={params.selectedDocument.id}
    >
      <div className="explorer-detail-header">
        <div className="explorer-detail-copy">
          <strong>{params.selectedDocument.title}</strong>
          <span>
            {getStoredDocumentTypeLabel(selectedDocumentKind)}
            {selectedDocumentContainer
              ? ` in ${selectedDocumentContainer.name}`
              : ""}
          </span>
        </div>
        <ExplorerDocumentDetailActions
          canLinkSelectedDocument={params.canLinkSelectedDocument}
          canMoveSelectedDocument={params.canMoveSelectedDocument}
          openLinkDocumentModal={params.openLinkDocumentModal}
          openMoveDocumentModal={params.openMoveDocumentModal}
          selectedDocument={params.selectedDocument}
          setSelectedId={params.setSelectedId}
        />
      </div>
      {params.refreshError ? (
        <span className="explorer-detail-error">{params.refreshError}</span>
      ) : null}
      <ExplorerLinkedContainerSection
        activateLinkedContainer={params.activateLinkedContainer}
        canActivateSelectedDocument={params.canActivateSelectedDocument}
        canUnlinkSelectedDocument={params.canUnlinkSelectedDocument}
        linkedContainerIds={params.linkedContainerIds}
        nodes={params.nodes}
        selectedDocument={params.selectedDocument}
        setSelectedId={params.setSelectedId}
        unlinkDocument={params.unlinkDocument}
      />
      <div className="explorer-inline-note">
        <SelectedDocumentApp
          localId={params.selectedDocument.id}
          {...(params.selectedDocument.containerId === undefined
            ? {}
            : { containerId: params.selectedDocument.containerId })}
          {...(params.selectedDocument.documentId === undefined
            ? {}
            : { documentId: params.selectedDocument.documentId })}
        />
      </div>
    </div>
  );
}

function getExplorerContainerItemTypeLabel(
  row: ExplorerContainerItemRow,
): string {
  if (row.itemKind === "container") {
    return EXPLORER_LABELS.folderType;
  }

  return getStoredDocumentTypeLabel(row.documentKind);
}

function getExplorerContainerItemRowKey(row: ExplorerContainerItemRow): string {
  return row.itemKind === "container"
    ? `container:${row.id}`
    : `document:${row.localId}:${row.containerId}`;
}

function useExplorerContainerItemViewport(frameRef: {
  current: HTMLDivElement | null;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const handleScroll = () => {
      setScrollTop(frame.scrollTop);
    };

    handleScroll();
    frame.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      frame.removeEventListener("scroll", handleScroll);
    };
  }, [frameRef]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (entry) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    resizeObserver.observe(frame);
    setViewportHeight(frame.clientHeight);

    return () => {
      resizeObserver.disconnect();
    };
  }, [frameRef]);

  return { scrollTop, setScrollTop, viewportHeight };
}

function useExplorerContainerItemRange(params: {
  frameRef: { current: HTMLDivElement | null };
  resetKey: string;
}) {
  const { frameRef, resetKey } = params;
  const { scrollTop, setScrollTop, viewportHeight } =
    useExplorerContainerItemViewport(frameRef);

  useEffect(() => {
    setScrollTop(0);
    if (frameRef.current) {
      frameRef.current.scrollTop = 0;
    }
  }, [frameRef, resetKey, setScrollTop]);

  const visibleRows = Math.ceil(viewportHeight / EXPLORER_VIRTUAL_ROW_HEIGHT);
  const offset = Math.max(
    0,
    Math.floor(scrollTop / EXPLORER_VIRTUAL_ROW_HEIGHT) -
      EXPLORER_VIRTUAL_OVERSCAN_ROWS,
  );
  const limit = Math.max(
    EXPLORER_VIRTUAL_MIN_WINDOW_ROWS,
    visibleRows + EXPLORER_VIRTUAL_OVERSCAN_ROWS * 2,
  );

  return { limit, offset };
}

function useExplorerContainerItemWindow(params: {
  documentReadModel: ExplorerDocumentReadModel;
  enabled: boolean;
  limit: number;
  offset: number;
  reloadKey: unknown;
  selectedNode: ContainerNode;
  sort: ExplorerContainerItemSort;
}) {
  const {
    documentReadModel,
    enabled,
    limit,
    offset,
    reloadKey,
    selectedNode,
    sort,
  } = params;
  const [state, setState] = useState<{
    error: string | null;
    isLoading: boolean;
    offset: number;
    rows: ReadonlyArray<ExplorerContainerItemRow>;
    totalCount: number;
  }>({
    error: null,
    isLoading: false,
    offset: 0,
    rows: [],
    totalCount: 0,
  });

  useEffect(() => {
    if (!enabled) {
      setState({
        error: null,
        isLoading: false,
        offset: 0,
        rows: [],
        totalCount: 0,
      });
      return;
    }

    let cancelled = false;
    setState((current) => ({
      ...current,
      error: null,
      isLoading: true,
    }));

    void documentReadModel
      .listContainerItemWindow({
        containerId: selectedNode.id,
        limit,
        offset,
        sort,
      })
      .then((window) => {
        if (cancelled) {
          return;
        }

        setState({
          error: null,
          isLoading: false,
          offset,
          rows: window.rows,
          totalCount: window.totalCount,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
          isLoading: false,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [
    documentReadModel,
    enabled,
    limit,
    offset,
    reloadKey,
    selectedNode.id,
    sort,
  ]);

  return state;
}

function ExplorerContainerItemName(params: {
  row: ExplorerContainerItemRow;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const { row, selectDocumentProjection, setSelectedId } = params;

  return (
    <MiniAppTableActionButton
      onClick={() => {
        if (row.itemKind === "container") {
          setSelectedId(row.id);
          return;
        }

        selectDocumentProjection(row.localId, row.containerId);
      }}
    >
      {row.name}
    </MiniAppTableActionButton>
  );
}

function ExplorerContainerItemTable(params: {
  error: string | null;
  frameRef: { current: HTMLDivElement | null };
  isLoading: boolean;
  onSort: (key: ExplorerContainerItemSortKey) => void;
  rows: ReadonlyArray<ExplorerContainerItemRow>;
  rowOffset: number;
  selectedNode: ContainerNode;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
  sort: ExplorerContainerItemSort;
  totalCount: number;
}) {
  const {
    error,
    frameRef,
    isLoading,
    onSort,
    rows,
    rowOffset,
    selectedNode,
    selectDocumentProjection,
    setSelectedId,
    sort,
    totalCount,
  } = params;
  const columns = useMemo(
    () => getExplorerItemTableColumns({ onSort, sort }),
    [onSort, sort],
  );
  const topPadding = rowOffset * EXPLORER_VIRTUAL_ROW_HEIGHT;
  const bottomPadding =
    Math.max(0, totalCount - rowOffset - rows.length) *
    EXPLORER_VIRTUAL_ROW_HEIGHT;

  return (
    <MiniAppTableFrame className="explorer-item-table-wrap" ref={frameRef}>
      <MiniAppTable
        aria-label={getExplorerItemTableLabel(selectedNode.name)}
        columns={columns}
      >
        {topPadding > 0 ? (
          <MiniAppTableEmptyRow
            aria-hidden="true"
            className="explorer-virtual-spacer-row"
            colSpan={columns.length}
            style={{ height: topPadding }}
          >
            {""}
          </MiniAppTableEmptyRow>
        ) : null}
        {rows.length > 0 ? (
          rows.map((row) => (
            <MiniAppTableRow key={getExplorerContainerItemRowKey(row)}>
              <MiniAppTableCell>
                <ExplorerContainerItemName
                  row={row}
                  selectDocumentProjection={selectDocumentProjection}
                  setSelectedId={setSelectedId}
                />
              </MiniAppTableCell>
              <MiniAppTableCell>
                {getExplorerContainerItemTypeLabel(row)}
              </MiniAppTableCell>
              <MiniAppTableCell title={row.createdAt ?? undefined}>
                {formatMiniAppDateTime(row.createdAt, {
                  emptyFallback: EXPLORER_LABELS.unknownDate,
                })}
              </MiniAppTableCell>
              <MiniAppTableCell title={row.updatedAt ?? undefined}>
                {formatMiniAppDateTime(row.updatedAt, {
                  emptyFallback: EXPLORER_LABELS.unknownDate,
                })}
              </MiniAppTableCell>
            </MiniAppTableRow>
          ))
        ) : isLoading ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            Loading...
          </MiniAppTableEmptyRow>
        ) : error ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {error}
          </MiniAppTableEmptyRow>
        ) : totalCount === 0 ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {EXPLORER_LABELS.itemTableEmpty}
          </MiniAppTableEmptyRow>
        ) : null}
        {bottomPadding > 0 ? (
          <MiniAppTableEmptyRow
            aria-hidden="true"
            className="explorer-virtual-spacer-row"
            colSpan={columns.length}
            style={{ height: bottomPadding }}
          >
            {""}
          </MiniAppTableEmptyRow>
        ) : null}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function ExplorerContainerDetail(params: {
  documentListRevision: number;
  documentReadModel: ExplorerDocumentReadModel;
  nodes: ReadonlyArray<ContainerNode>;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  refreshError: string | null;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  selectedNode: ContainerNode;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    documentListRevision,
    documentReadModel,
    openInlineDocument,
    refreshError,
    selectDocumentProjection,
    selectedNode,
    setSelectedId,
  } = params;
  const [sort, setSort] = useState<ExplorerContainerItemSort>({
    direction: "asc",
    key: "name",
  });
  const frameRef = useRef<HTMLDivElement | null>(null);
  const resetKey = `${selectedNode.id}:${sort.key}:${sort.direction}`;
  const { limit, offset } = useExplorerContainerItemRange({
    frameRef,
    resetKey,
  });
  const itemWindow = useExplorerContainerItemWindow({
    documentReadModel,
    enabled: true,
    limit,
    offset,
    reloadKey: documentListRevision,
    selectedNode,
    sort,
  });
  const isShowingRequestedWindow = itemWindow.offset === offset;
  const rows = isShowingRequestedWindow ? itemWindow.rows : [];
  const rowOffset = isShowingRequestedWindow ? itemWindow.offset : offset;
  const handleSort = useCallback((key: ExplorerContainerItemSortKey) => {
    setSort((currentSort) => getNextExplorerItemSort(currentSort, key));
  }, []);

  return (
    <div
      className="explorer-detail explorer-detail--container"
      key={selectedNode.id}
    >
      <div className="explorer-detail-header">
        <div className="explorer-detail-copy">
          <strong>{selectedNode.name}</strong>
          <span>{EXPLORER_LABELS.folderType}</span>
        </div>
        <div className="explorer-detail-actions">
          {DOCUMENT_TYPE_DEFINITIONS.map((definition) => (
            <button
              type="button"
              key={definition.kind}
              className="explorer-action-button"
              onClick={() => {
                openInlineDocument(selectedNode.id, definition.kind);
              }}
            >
              {definition.createLabel}
            </button>
          ))}
        </div>
      </div>
      {refreshError ? (
        <span className="explorer-detail-error">{refreshError}</span>
      ) : null}
      <ExplorerContainerItemTable
        error={itemWindow.error}
        frameRef={frameRef}
        isLoading={itemWindow.isLoading}
        onSort={handleSort}
        rowOffset={rowOffset}
        rows={rows}
        selectedNode={selectedNode}
        selectDocumentProjection={selectDocumentProjection}
        setSelectedId={setSelectedId}
        sort={sort}
        totalCount={itemWindow.totalCount}
      />
    </div>
  );
}

function ExplorerEmptyDetail(params: {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}) {
  const { nodes, ready } = params;

  return (
    <div className="explorer-hint">
      {ready && nodes.length > 0
        ? "Select a container."
        : !ready
          ? "Loading..."
          : "No containers."}
    </div>
  );
}

export function ExplorerDetailPanel(params: {
  activateLinkedContainer: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  documentListRevision: number;
  documentReadModel: ExplorerDocumentReadModel;
  linkedContainerIds: ReadonlyArray<string>;
  loadContainerInfo: (containerId: string) => Promise<ExplorerContainerInfo>;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToSelectionRoute: () => void;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  peerUserId: string | null;
  ready: boolean;
  refreshError: string | null;
  route: ExplorerRoute;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  selectedDocument: DocumentSummary | undefined;
  selectedNode: ContainerNode | undefined;
  setSelectedId: (id: string | null) => void;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ExplorerContainerShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const { route, selectedDocument, selectedNode } = params;

  if (route.view === "container-info") {
    const infoNode = params.nodes.find((node) => node.id === route.containerId);
    return (
      <ExplorerContainerInfoPanel
        containerId={route.containerId}
        containerName={infoNode?.name}
        loadContainerInfo={params.loadContainerInfo}
        onBackToContainer={params.onBackToSelectionRoute}
        peerUserId={params.peerUserId}
        shareWithGroup={params.shareWithGroup}
        shareWithUser={params.shareWithUser}
      />
    );
  }

  if (selectedDocument) {
    return (
      <ExplorerDocumentDetail {...params} selectedDocument={selectedDocument} />
    );
  }

  if (selectedNode) {
    return <ExplorerContainerDetail {...params} selectedNode={selectedNode} />;
  }

  return <ExplorerEmptyDetail nodes={params.nodes} ready={params.ready} />;
}
