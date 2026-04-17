import { useState } from "react";
import {
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "../../../data/documents/documentKinds";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";
import {
  DOCUMENT_TYPE_DEFINITIONS,
  getDocumentTypeDefinition,
} from "../../../document-types/registry";
import type { ContainerNode } from "../types";

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

function ExplorerRefreshButton(params: {
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  ready: boolean;
}) {
  const { handleRefresh, isRefreshing, ready } = params;

  return (
    <button
      type="button"
      className="explorer-action-button"
      disabled={!ready || isRefreshing}
      onClick={() => {
        void handleRefresh();
      }}
    >
      {isRefreshing ? "Refreshing..." : "Refresh"}
    </button>
  );
}

function ExplorerDocumentDetailActions(params: {
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  ready: boolean;
  selectedDocument: DocumentSummary;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    canLinkSelectedDocument,
    canMoveSelectedDocument,
    handleRefresh,
    isRefreshing,
    openLinkDocumentModal,
    openMoveDocumentModal,
    ready,
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
      <ExplorerRefreshButton
        handleRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        ready={ready}
      />
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
    <li className="explorer-linked-container-row">
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
    </li>
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
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  nodes: ReadonlyArray<ContainerNode>;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  ready: boolean;
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
          handleRefresh={params.handleRefresh}
          isRefreshing={params.isRefreshing}
          openLinkDocumentModal={params.openLinkDocumentModal}
          openMoveDocumentModal={params.openMoveDocumentModal}
          ready={params.ready}
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

function ExplorerContainerDetail(params: {
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  ready: boolean;
  refreshError: string | null;
  selectedNode: ContainerNode;
}) {
  const {
    handleRefresh,
    isRefreshing,
    openInlineDocument,
    ready,
    refreshError,
    selectedNode,
  } = params;

  return (
    <div className="explorer-detail" key={selectedNode.id}>
      <div className="explorer-detail-header">
        <div className="explorer-detail-copy">
          <strong>{selectedNode.name}</strong>
          <span>{selectedNode.kind}</span>
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
          <ExplorerRefreshButton
            handleRefresh={handleRefresh}
            isRefreshing={isRefreshing}
            ready={ready}
          />
        </div>
      </div>
      <span>ID: {selectedNode.id}</span>
      <span>Parent: {selectedNode.parentId ?? "(root)"}</span>
      <span>Organization: {selectedNode.organizationId || "(local)"}</span>
      {refreshError ? (
        <span className="explorer-detail-error">{refreshError}</span>
      ) : null}
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
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  nodes: ReadonlyArray<ContainerNode>;
  openInlineDocument: (
    containerId: string,
    documentKind: StoredDocumentKind,
    localId?: string,
  ) => void;
  openLinkDocumentModal: (noteId: string) => void;
  openMoveDocumentModal: (noteId: string) => void;
  ready: boolean;
  refreshError: string | null;
  selectedDocument: DocumentSummary | undefined;
  selectedNode: ContainerNode | undefined;
  setSelectedId: (id: string | null) => void;
  unlinkDocument: (
    noteId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const { selectedDocument, selectedNode } = params;

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
