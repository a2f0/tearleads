import { useMemo, useState } from "react";
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
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import type { DocumentContainerProjection } from "../documentProjections";
import { EXPLORER_LABELS, getExplorerItemTableLabel } from "../labels";
import type { ExplorerRoute } from "../routes";
import type { ContainerNode } from "../types";
import { ExplorerContainerInfoPanel } from "./ExplorerContainerInfoPanel";

const EXPLORER_ITEM_TABLE_COLUMNS = [
  {
    id: "name",
    header: EXPLORER_LABELS.itemNameColumn,
    width: "40%",
  },
  {
    id: "type",
    header: EXPLORER_LABELS.itemTypeColumn,
    width: "8rem",
  },
  {
    id: "created",
    header: EXPLORER_LABELS.dateCreatedColumn,
    width: "11rem",
  },
  {
    id: "modified",
    header: EXPLORER_LABELS.dateModifiedColumn,
    width: "11rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

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

type ExplorerFolderItemRow =
  | {
      createdAt: string | null;
      id: string;
      itemKind: "container";
      name: string;
      typeLabel: string;
      updatedAt: string | null;
    }
  | {
      containerId: string;
      createdAt: string | null;
      itemKind: "document";
      localId: string;
      name: string;
      typeLabel: string;
      updatedAt: string | null;
    };

function compareExplorerFolderItemRows(
  left: ExplorerFolderItemRow,
  right: ExplorerFolderItemRow,
): number {
  if (left.itemKind !== right.itemKind) {
    return left.itemKind === "container" ? -1 : 1;
  }

  const nameComparison = left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
  });
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return left.typeLabel.localeCompare(right.typeLabel, undefined, {
    sensitivity: "base",
  });
}

function getExplorerFolderItemRows(params: {
  documents: ReadonlyArray<DocumentContainerProjection>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedNode: ContainerNode;
}): ExplorerFolderItemRow[] {
  const { documents, nodes, selectedNode } = params;
  const childFolderRows = nodes
    .filter((node) => node.parentId === selectedNode.id)
    .map<ExplorerFolderItemRow>((node) => ({
      createdAt: node.createdAt ?? node.updatedAt ?? null,
      id: node.id,
      itemKind: "container",
      name: node.name,
      typeLabel: EXPLORER_LABELS.folderType,
      updatedAt: node.updatedAt ?? node.createdAt ?? null,
    }));
  const documentRows = documents.map<ExplorerFolderItemRow>((document) => ({
    containerId: document.containerId,
    createdAt: document.createdAt,
    itemKind: "document",
    localId: document.localId,
    name: document.title,
    typeLabel: getStoredDocumentTypeLabel(document.documentKind),
    updatedAt: document.updatedAt,
  }));

  return [...childFolderRows, ...documentRows].sort(
    compareExplorerFolderItemRows,
  );
}

function ExplorerContainerItemName(params: {
  row: ExplorerFolderItemRow;
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
  rows: ReadonlyArray<ExplorerFolderItemRow>;
  selectedNode: ContainerNode;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const { rows, selectedNode, selectDocumentProjection, setSelectedId } =
    params;

  return (
    <MiniAppTableFrame className="explorer-item-table-wrap">
      <MiniAppTable
        aria-label={getExplorerItemTableLabel(selectedNode.name)}
        columns={EXPLORER_ITEM_TABLE_COLUMNS}
      >
        {rows.length > 0 ? (
          rows.map((row) => (
            <MiniAppTableRow
              key={
                row.itemKind === "container"
                  ? `container:${row.id}`
                  : `document:${row.localId}:${row.containerId}`
              }
            >
              <MiniAppTableCell>
                <ExplorerContainerItemName
                  row={row}
                  selectDocumentProjection={selectDocumentProjection}
                  setSelectedId={setSelectedId}
                />
              </MiniAppTableCell>
              <MiniAppTableCell>{row.typeLabel}</MiniAppTableCell>
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
        ) : (
          <MiniAppTableEmptyRow colSpan={EXPLORER_ITEM_TABLE_COLUMNS.length}>
            {EXPLORER_LABELS.itemTableEmpty}
          </MiniAppTableEmptyRow>
        )}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function ExplorerContainerDetail(params: {
  documentsByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentContainerProjection>
  >;
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
    documentsByContainerId,
    nodes,
    openInlineDocument,
    refreshError,
    selectDocumentProjection,
    selectedNode,
    setSelectedId,
  } = params;
  const rows = useMemo(
    () =>
      getExplorerFolderItemRows({
        documents: documentsByContainerId.get(selectedNode.id) ?? [],
        nodes,
        selectedNode,
      }),
    [documentsByContainerId, nodes, selectedNode],
  );

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
        rows={rows}
        selectedNode={selectedNode}
        selectDocumentProjection={selectDocumentProjection}
        setSelectedId={setSelectedId}
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
  documentsByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentContainerProjection>
  >;
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
