import type {
  ContainerDocumentObjectSyncState,
  ContainerDocumentQueries,
  ContainerNode,
} from "@tearleads/client-sdk";
import {
  createContainerDocumentObjectSyncState,
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../document-types/projectors";
import { getDocumentTypeDefinition } from "../../../document-types/registry";
import { ExplorerSyncStateBadge } from "../ExplorerSyncStateBadge";
import { EXPLORER_LABELS, getExplorerDocumentSubtitle } from "../labels";
import { ExplorerLinkedContainerSection } from "./ExplorerLinkedContainers";

export { getLinkedContainerDetails } from "./ExplorerLinkedContainers";

function getDocumentSummaryKind(
  documentSummary: Pick<DocumentSummary, "documentKind">,
): StoredDocumentKind {
  return documentSummary.documentKind ?? DEFAULT_DOCUMENT_KIND;
}

function ExplorerDocumentDetailActions(params: {
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openLinkDocumentModal: (documentId: string) => void;
  openMoveDocumentModal: (documentId: string) => void;
  selectedDocument: DocumentSummary;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    canLinkSelectedDocument,
    canMoveSelectedDocument,
    openDocumentInfoRoute,
    openLinkDocumentModal,
    openMoveDocumentModal,
    selectedDocument,
    setSelectedId,
  } = params;

  return (
    <MiniAppActions>
      <MiniAppButton
        onClick={() => {
          if (selectedDocument.containerId) {
            setSelectedId(selectedDocument.containerId);
          }
        }}
      >
        {EXPLORER_LABELS.documentBackToContainerAction}
      </MiniAppButton>
      <MiniAppButton
        disabled={!selectedDocument.containerId}
        onClick={() => {
          if (selectedDocument.containerId) {
            openDocumentInfoRoute(
              selectedDocument.id,
              selectedDocument.containerId,
            );
          }
        }}
      >
        {EXPLORER_LABELS.documentInfoGetInfoAction}
      </MiniAppButton>
      <MiniAppButton
        disabled={!canLinkSelectedDocument}
        onClick={() => {
          openLinkDocumentModal(selectedDocument.id);
        }}
      >
        {EXPLORER_LABELS.documentLinkAction}
      </MiniAppButton>
      <MiniAppButton
        disabled={!canMoveSelectedDocument}
        onClick={() => {
          openMoveDocumentModal(selectedDocument.id);
        }}
      >
        {EXPLORER_LABELS.documentMoveAction}
      </MiniAppButton>
    </MiniAppActions>
  );
}

function useSelectedDocumentSyncState(params: {
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  selectedDocument: DocumentSummary;
}): ContainerDocumentObjectSyncState {
  const { documentListRevision, documentQueries, selectedDocument } = params;
  const fallbackSyncState = useMemo(
    () =>
      createContainerDocumentObjectSyncState({
        localOnly: selectedDocument.documentId === null,
      }),
    [selectedDocument.documentId],
  );
  const [syncState, setSyncState] = useState(fallbackSyncState);
  const selectedDocumentIdRef = useRef(selectedDocument.id);

  useEffect(() => {
    let cancelled = false;
    const selectedDocumentChanged =
      selectedDocumentIdRef.current !== selectedDocument.id;
    selectedDocumentIdRef.current = selectedDocument.id;
    if (selectedDocumentChanged) {
      setSyncState(fallbackSyncState);
    }

    void documentQueries
      .loadDocumentSyncState(selectedDocument.id)
      .then((nextSyncState) => {
        if (!cancelled && nextSyncState) {
          setSyncState(nextSyncState);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        // Apply the fallback on the refresh path too (same document, new
        // revision), not only when the selected document changed — otherwise a
        // failed reload leaves stale sync status with no error surfaced.
        console.error("Explorer: failed to load document sync state:", error);
        setSyncState(fallbackSyncState);
      });

    return () => {
      cancelled = true;
    };
  }, [
    documentListRevision,
    documentQueries,
    fallbackSyncState,
    selectedDocument.id,
  ]);

  return syncState;
}

export function ExplorerDocumentDetail(params: {
  activateLinkedContainer: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  linkedContainerIds: ReadonlyArray<string>;
  nodes: ReadonlyArray<ContainerNode>;
  online: boolean;
  openLinkDocumentModal: (documentId: string) => void;
  openDocumentInfoRoute: (localId: string, containerId: string) => void;
  openMoveDocumentModal: (documentId: string) => void;
  refreshError: string | null;
  selectedDocument: DocumentSummary;
  setSelectedId: (id: string | null) => void;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const selectedDocumentKind = getDocumentSummaryKind(params.selectedDocument);
  const selectedDocumentContainer = params.selectedDocument.containerId
    ? params.nodes.find(
        (node) => node.id === params.selectedDocument.containerId,
      )
    : null;
  const selectedDocumentSyncState = useSelectedDocumentSyncState({
    documentListRevision: params.documentListRevision,
    documentQueries: params.documentQueries,
    selectedDocument: params.selectedDocument,
  });
  const SelectedDocumentApp =
    getDocumentTypeDefinition(selectedDocumentKind).App;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--note"
      key={params.selectedDocument.id}
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <div className="explorer-detail-title-row">
            <strong>{params.selectedDocument.title}</strong>
            <ExplorerSyncStateBadge
              online={params.online}
              showSynced
              syncState={selectedDocumentSyncState}
            />
          </div>
          <span>
            {getExplorerDocumentSubtitle({
              containerName: selectedDocumentContainer?.name ?? null,
              documentTypeLabel: getStoredDocumentTypeLabel(
                selectedDocumentKind,
                APP_DOCUMENT_PROJECTOR_DEFINITIONS,
              ),
            })}
          </span>
        </MiniAppHeaderCopy>
        <ExplorerDocumentDetailActions
          canLinkSelectedDocument={params.canLinkSelectedDocument}
          canMoveSelectedDocument={params.canMoveSelectedDocument}
          openDocumentInfoRoute={params.openDocumentInfoRoute}
          openLinkDocumentModal={params.openLinkDocumentModal}
          openMoveDocumentModal={params.openMoveDocumentModal}
          selectedDocument={params.selectedDocument}
          setSelectedId={params.setSelectedId}
        />
      </MiniAppHeader>
      {params.refreshError ? (
        <MiniAppStatus as="span" tone="error">
          {params.refreshError}
        </MiniAppStatus>
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
    </MiniAppPanel>
  );
}
