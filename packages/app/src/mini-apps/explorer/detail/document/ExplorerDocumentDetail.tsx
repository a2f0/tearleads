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
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../../document-types/projectors";
import { getDocumentTypeDefinition } from "../../../../document-types/registry";
import { getViewerRelativeContactDocumentLabel } from "../../../../stores/contacts/contactLabels";
import { getExplorerDocumentSubtitle } from "../../labels";
import { ExplorerSyncStateBadge } from "../../shared/ExplorerSyncStateBadge";

export { getLinkedContainerDetails } from "./ExplorerLinkedContainers";

function getDocumentSummaryKind(
  documentSummary: Pick<DocumentSummary, "documentKind">,
): StoredDocumentKind {
  return documentSummary.documentKind ?? DEFAULT_DOCUMENT_KIND;
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
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId: string | null | undefined;
  currentUserId: string | null | undefined;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  initialEditing: boolean;
  nodes: ReadonlyArray<ContainerNode>;
  onInitialEditingConsumed: (localId: string) => void;
  online: boolean;
  readOnly: boolean;
  refreshError: string | null;
  selectedDocument: DocumentSummary;
  showHeaderSyncIndicator: boolean;
}) {
  const selectedDocumentKind = getDocumentSummaryKind(params.selectedDocument);
  // Resolve the unnamed self-contact to "You", matching the sidebar and the
  // container item table; without this the detail header shows the raw UUID.
  const selectedDocumentTitle = getViewerRelativeContactDocumentLabel({
    currentSigningFingerprint: params.currentSigningFingerprint,
    currentSelfContactLocalId: params.currentSelfContactLocalId,
    currentUserId: params.currentUserId,
    documentKind: selectedDocumentKind,
    fallbackLabel: params.selectedDocument.title,
    localId: params.selectedDocument.id,
  });
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
  useEffect(() => {
    if (params.initialEditing) {
      params.onInitialEditingConsumed(params.selectedDocument.id);
    }
  }, [
    params.initialEditing,
    params.onInitialEditingConsumed,
    params.selectedDocument.id,
  ]);

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--note"
      key={params.selectedDocument.id}
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{selectedDocumentTitle}</strong>
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
        {params.showHeaderSyncIndicator ? (
          <ExplorerSyncStateBadge
            online={params.online}
            syncState={selectedDocumentSyncState}
          />
        ) : null}
      </MiniAppHeader>
      {params.refreshError ? (
        <MiniAppStatus as="span" tone="error">
          {params.refreshError}
        </MiniAppStatus>
      ) : null}
      <div className="explorer-inline-note">
        <SelectedDocumentApp
          initialEditing={params.readOnly ? false : params.initialEditing}
          localId={params.selectedDocument.id}
          readOnly={params.readOnly}
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
