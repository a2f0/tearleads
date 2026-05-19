import { useState } from "react";
import { MiniAppRow } from "../../../components/shared/MiniAppRow";
import type { DocumentSummary } from "../../../data/documentSummary";
import {
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "../../../data/documents/documentKinds";
import { APP_DOCUMENT_PROJECTOR_REGISTRY } from "../../../document-types/projectors";
import { getDocumentTypeDefinition } from "../../../document-types/registry";
import type { ContainerNode } from "../../../stores/explorer/types";
import {
  EXPLORER_LABELS,
  getExplorerActivateLinkedContainerError,
  getExplorerDetachLinkedContainerError,
  getExplorerDetachLinkedContainerLabel,
  getExplorerDocumentSubtitle,
  getExplorerMakeLinkedContainerActiveLabel,
  getExplorerOpenLinkedContainerLabel,
} from "../labels";

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

export function getLinkedContainerDetails(
  nodes: ReadonlyArray<ContainerNode>,
  linkedContainerIds: ReadonlyArray<string>,
  activeContainerId: string | null,
): ReadonlyArray<LinkedContainerDetail> {
  const nodesById = new Map<string, ContainerNode>();
  for (const node of nodes) {
    if (!nodesById.has(node.id)) {
      nodesById.set(node.id, node);
    }
  }

  return linkedContainerIds.map((linkedContainerId) => {
    const linkedContainer = nodesById.get(linkedContainerId);

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
        {EXPLORER_LABELS.documentBackToContainerAction}
      </button>
      <button
        type="button"
        className="explorer-action-button"
        disabled={!canLinkSelectedDocument}
        onClick={() => {
          openLinkDocumentModal(selectedDocument.id);
        }}
      >
        {EXPLORER_LABELS.documentLinkAction}
      </button>
      <button
        type="button"
        className="explorer-action-button"
        disabled={!canMoveSelectedDocument}
        onClick={() => {
          openMoveDocumentModal(selectedDocument.id);
        }}
      >
        {EXPLORER_LABELS.documentMoveAction}
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
      setActionError(
        getExplorerActivateLinkedContainerError(linkedContainer.label),
      );
    }
  } catch {
    setActionError(
      getExplorerActivateLinkedContainerError(linkedContainer.label),
    );
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
      setActionError(
        getExplorerDetachLinkedContainerError(linkedContainer.label),
      );
    }
  } catch {
    setActionError(
      getExplorerDetachLinkedContainerError(linkedContainer.label),
    );
  } finally {
    setUnlinkingContainerId(null);
  }
}

interface ExplorerLinkedContainerRowParams {
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
}

function ExplorerLinkedContainerRow(params: ExplorerLinkedContainerRowParams) {
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
  const actionBusy =
    activatingContainerId !== null || unlinkingContainerId !== null;

  return (
    <MiniAppRow
      as="li"
      className="explorer-linked-container-row"
      variant="framed"
    >
      <button
        type="button"
        className="explorer-linked-container-button"
        aria-label={getExplorerOpenLinkedContainerLabel(linkedContainer.label)}
        onClick={() => {
          setSelectedId(linkedContainer.id);
        }}
      >
        {linkedContainer.label}
      </button>
      <div className="explorer-linked-container-actions">
        {linkedContainer.isActive ? (
          <span className="explorer-linked-container-badge">
            {EXPLORER_LABELS.linkedContainerActiveBadge}
          </span>
        ) : (
          <button
            type="button"
            className="explorer-action-button"
            aria-label={getExplorerMakeLinkedContainerActiveLabel(
              linkedContainer.label,
            )}
            disabled={!canActivateSelectedDocument || actionBusy}
            onClick={() => {
              if (actionBusy) {
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
              ? EXPLORER_LABELS.linkedContainerActivatingAction
              : EXPLORER_LABELS.linkedContainerMakeActiveAction}
          </button>
        )}
        <button
          type="button"
          className="explorer-action-button"
          aria-label={getExplorerDetachLinkedContainerLabel(
            linkedContainer.label,
          )}
          disabled={!canUnlinkSelectedDocument || actionBusy}
          onClick={() => {
            if (actionBusy) {
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
            ? EXPLORER_LABELS.linkedContainerDetachingAction
            : EXPLORER_LABELS.linkedContainerDetachAction}
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
      <strong>{EXPLORER_LABELS.linkedContainersHeading}</strong>
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

export function ExplorerDocumentDetail(params: {
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
            {getExplorerDocumentSubtitle({
              containerName: selectedDocumentContainer?.name ?? null,
              documentTypeLabel: getStoredDocumentTypeLabel(
                selectedDocumentKind,
                APP_DOCUMENT_PROJECTOR_REGISTRY,
              ),
            })}
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
          {...(params.selectedDocument.containerId === null
            ? {}
            : { containerId: params.selectedDocument.containerId })}
          {...(params.selectedDocument.documentId === null
            ? {}
            : { documentId: params.selectedDocument.documentId })}
        />
      </div>
    </div>
  );
}
