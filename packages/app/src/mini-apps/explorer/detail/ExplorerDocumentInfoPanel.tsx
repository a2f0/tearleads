import type {
  ContainerNode,
  DocumentInfo,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { unknownErrorMessage } from "../../../utils/unknownErrorMessage";
import { EXPLORER_LABELS } from "../labels";
import { getDocumentLinkedContainerIds } from "../targetOptions";
import { compactId } from "./compactId";
import {
  ExplorerDocumentInfoAttachmentsSection,
  ExplorerDocumentInfoAuthorizingContainersSection,
  ExplorerDocumentInfoGeneralSection,
  ExplorerDocumentInfoLocalSecuritySection,
  ExplorerDocumentInfoRemoteSecuritySection,
  type OpenBlobBrowserRoute,
} from "./ExplorerDocumentInfoSections";
import { ExplorerLinkedContainerSection } from "./ExplorerLinkedContainers";

type DocumentInfoTabId = "general" | "links" | "blobs" | "security";

const DOCUMENT_INFO_TABS: ReadonlyArray<{
  id: DocumentInfoTabId;
  label: string;
}> = [
  { id: "general", label: EXPLORER_LABELS.documentInfoGeneralTab },
  { id: "links", label: EXPLORER_LABELS.documentInfoLinksTab },
  { id: "blobs", label: EXPLORER_LABELS.documentInfoBlobsTab },
  { id: "security", label: EXPLORER_LABELS.documentInfoSecurityTab },
];

interface Props {
  activateLinkedContainer: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateLinkedContainer: boolean;
  canMutateDocumentLinks: boolean;
  containerId: string;
  documentTitle: string | undefined;
  fallbackDocumentSummary: DocumentSummary | null;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  localId: string;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToDocument: () => void;
  openBlobBrowserRoute: OpenBlobBrowserRoute;
  setSelectedId: (id: string | null) => void;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}

function useExplorerDocumentInfo(params: {
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  localId: string;
}) {
  const { loadDocumentInfo, localId } = params;
  const requestIdRef = useRef(0);
  const [documentInfo, setDocumentInfo] = useState<DocumentInfo | null>(null);
  const [documentInfoError, setDocumentInfoError] = useState<string | null>(
    null,
  );
  const [isLoadingDocumentInfo, setIsLoadingDocumentInfo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoadingDocumentInfo(true);
    setDocumentInfoError(null);
    setDocumentInfo(null);

    void loadDocumentInfo(localId)
      .then((info) => {
        if (!cancelled && requestIdRef.current === requestId) {
          setDocumentInfo(info);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && requestIdRef.current === requestId) {
          setDocumentInfoError(unknownErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled && requestIdRef.current === requestId) {
          setIsLoadingDocumentInfo(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadDocumentInfo, localId]);

  return { documentInfo, documentInfoError, isLoadingDocumentInfo };
}

function useExplorerDocumentSummary(params: {
  fallbackDocumentSummary: DocumentSummary | null;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  localId: string;
}) {
  const { fallbackDocumentSummary, loadDocumentSummary, localId } = params;
  const requestIdRef = useRef(0);
  const [documentSummary, setDocumentSummary] =
    useState<DocumentSummary | null>(
      fallbackDocumentSummary?.id === localId ? fallbackDocumentSummary : null,
    );
  const [documentSummaryError, setDocumentSummaryError] = useState<
    string | null
  >(null);
  const [isLoadingDocumentSummary, setIsLoadingDocumentSummary] =
    useState(false);

  useEffect(() => {
    const fallback =
      fallbackDocumentSummary?.id === localId ? fallbackDocumentSummary : null;
    setDocumentSummary(fallback);
    setDocumentSummaryError(null);
    if (fallback) {
      setIsLoadingDocumentSummary(false);
      return;
    }

    let cancelled = false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoadingDocumentSummary(true);

    void loadDocumentSummary(localId)
      .then((summary) => {
        if (!cancelled && requestIdRef.current === requestId) {
          setDocumentSummary(summary);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && requestIdRef.current === requestId) {
          setDocumentSummaryError(unknownErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled && requestIdRef.current === requestId) {
          setIsLoadingDocumentSummary(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackDocumentSummary, loadDocumentSummary, localId]);

  return { documentSummary, documentSummaryError, isLoadingDocumentSummary };
}

function getDocumentInfoLinkedContainerIds(input: {
  documentInfo: DocumentInfo | null;
  documentSummary: DocumentSummary | null;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}): ReadonlyArray<string> {
  const { documentInfo, documentSummary, linkedContainerIdsByDocumentId } =
    input;
  if (documentSummary) {
    return getDocumentLinkedContainerIds({
      document: documentSummary,
      linkedContainerIdsByDocumentId,
    });
  }

  const defaultContainerIds = documentInfo?.local.containerId
    ? [documentInfo.local.containerId]
    : [];
  const documentId = documentInfo?.local.documentId;
  if (!documentId) {
    return defaultContainerIds;
  }

  const linkedContainerIds = linkedContainerIdsByDocumentId.get(documentId);
  return linkedContainerIds && linkedContainerIds.length > 0
    ? linkedContainerIds
    : defaultContainerIds;
}

function ExplorerDocumentInfoTabs(params: {
  activeTab: DocumentInfoTabId;
  idPrefix: string;
  setActiveTab: (tab: DocumentInfoTabId) => void;
}) {
  return (
    <div
      aria-label={EXPLORER_LABELS.documentInfoTabsLabel}
      className="explorer-info-tabs"
      role="tablist"
    >
      {DOCUMENT_INFO_TABS.map((tab) => (
        <MiniAppButton
          aria-controls={`${params.idPrefix}-${tab.id}-panel`}
          aria-selected={params.activeTab === tab.id}
          className="explorer-info-tab"
          id={`${params.idPrefix}-${tab.id}-tab`}
          key={tab.id}
          role="tab"
          variant="ghost"
          onClick={() => {
            params.setActiveTab(tab.id);
          }}
        >
          {tab.label}
        </MiniAppButton>
      ))}
    </div>
  );
}

function ExplorerDocumentInfoTabPanel(params: {
  activeContainerId: string | null;
  activeTab: DocumentInfoTabId;
  canActivateLinkedContainer: boolean;
  canUnlinkLinkedContainer: boolean;
  containerName: string | null;
  containerNamesById: ReadonlyMap<string, string>;
  documentInfo: DocumentInfo | null;
  documentSummaryError: string | null;
  idPrefix: string;
  isLoadingDocumentSummary: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  localId: string;
  nodes: ReadonlyArray<ContainerNode>;
  openBlobBrowserRoute: OpenBlobBrowserRoute;
  setSelectedId: (id: string | null) => void;
  activateLinkedContainer: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  return (
    <div
      aria-labelledby={`${params.idPrefix}-${params.activeTab}-tab`}
      className="explorer-info-tab-panel"
      id={`${params.idPrefix}-${params.activeTab}-panel`}
      role="tabpanel"
    >
      {params.activeTab === "general" ? (
        <ExplorerDocumentInfoGeneralSection
          containerName={params.containerName}
          documentInfo={params.documentInfo}
          localId={params.localId}
        />
      ) : null}
      {params.activeTab === "links" && params.documentInfo ? (
        <>
          {params.isLoadingDocumentSummary ? (
            <MiniAppStatus>{EXPLORER_LABELS.documentInfoLoading}</MiniAppStatus>
          ) : null}
          {params.documentSummaryError ? (
            <MiniAppStatus tone="error">
              {params.documentSummaryError}
            </MiniAppStatus>
          ) : null}
          <ExplorerLinkedContainerSection
            activeContainerId={params.activeContainerId}
            activateLinkedContainer={params.activateLinkedContainer}
            canActivateSelectedDocument={params.canActivateLinkedContainer}
            canUnlinkSelectedDocument={params.canUnlinkLinkedContainer}
            linkedContainerIds={params.linkedContainerIds}
            nodes={params.nodes}
            selectedDocumentId={params.localId}
            setSelectedId={params.setSelectedId}
            unlinkDocument={params.unlinkDocument}
          />
          <ExplorerDocumentInfoAuthorizingContainersSection
            containerNamesById={params.containerNamesById}
            documentInfo={params.documentInfo}
          />
        </>
      ) : null}
      {params.activeTab === "blobs" && params.documentInfo ? (
        <ExplorerDocumentInfoAttachmentsSection
          documentInfo={params.documentInfo}
          openBlobBrowserRoute={params.openBlobBrowserRoute}
        />
      ) : null}
      {params.activeTab === "security" ? (
        <>
          <ExplorerDocumentInfoLocalSecuritySection
            documentInfo={params.documentInfo}
          />
          {params.documentInfo ? (
            <ExplorerDocumentInfoRemoteSecuritySection
              documentInfo={params.documentInfo}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function useExplorerDocumentInfoPanelState(params: Props) {
  const tabIdPrefix = useId();
  const [activeTab, setActiveTab] = useState<DocumentInfoTabId>("general");
  const { documentInfo, documentInfoError, isLoadingDocumentInfo } =
    useExplorerDocumentInfo({
      loadDocumentInfo: params.loadDocumentInfo,
      localId: params.localId,
    });
  const { documentSummary, documentSummaryError, isLoadingDocumentSummary } =
    useExplorerDocumentSummary({
      fallbackDocumentSummary: params.fallbackDocumentSummary,
      loadDocumentSummary: params.loadDocumentSummary,
      localId: params.localId,
    });
  const containerNamesById = useMemo(
    () => new Map(params.nodes.map((node) => [node.id, node.name])),
    [params.nodes],
  );
  const containerName =
    containerNamesById.get(
      documentInfo?.local.containerId ?? params.containerId,
    ) ?? null;
  const title =
    params.documentTitle ??
    documentInfo?.local.title ??
    compactId(params.localId);
  const linkedContainerIds = getDocumentInfoLinkedContainerIds({
    documentInfo,
    documentSummary,
    linkedContainerIdsByDocumentId: params.linkedContainerIdsByDocumentId,
  });
  const activeContainerId =
    documentSummary?.containerId ?? documentInfo?.local.containerId ?? null;
  const hasRemoteDocument =
    !!documentSummary?.documentId || !!documentInfo?.local.documentId;
  const canActivateDocumentLink =
    params.canActivateLinkedContainer && hasRemoteDocument;
  const canUnlinkDocumentLink =
    params.canMutateDocumentLinks &&
    hasRemoteDocument &&
    linkedContainerIds.length > 1;

  useEffect(() => {
    setActiveTab("general");
  }, [params.localId]);

  return {
    activeContainerId,
    activeTab,
    canActivateDocumentLink,
    canUnlinkDocumentLink,
    containerName,
    containerNamesById,
    documentInfo,
    documentInfoError,
    documentSummaryError,
    isLoadingDocumentInfo,
    isLoadingDocumentSummary,
    linkedContainerIds,
    setActiveTab,
    tabIdPrefix,
    title,
  };
}

export function ExplorerDocumentInfoPanel(params: Props) {
  const model = useExplorerDocumentInfoPanelState(params);

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--document-info"
      key={params.localId}
      scroll
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.documentInfoTitle}</strong>
          <span>{model.title}</span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton onClick={params.onBackToDocument}>
            {EXPLORER_LABELS.documentInfoBackAction}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <div className="explorer-info">
        <ExplorerDocumentInfoTabs
          activeTab={model.activeTab}
          idPrefix={model.tabIdPrefix}
          setActiveTab={model.setActiveTab}
        />
        {model.isLoadingDocumentInfo && !model.documentInfo ? (
          <MiniAppStatus>{EXPLORER_LABELS.documentInfoLoading}</MiniAppStatus>
        ) : null}
        {model.documentInfoError ? (
          <MiniAppStatus tone="error">{model.documentInfoError}</MiniAppStatus>
        ) : null}
        <ExplorerDocumentInfoTabPanel
          activeContainerId={model.activeContainerId}
          activeTab={model.activeTab}
          activateLinkedContainer={params.activateLinkedContainer}
          canActivateLinkedContainer={model.canActivateDocumentLink}
          canUnlinkLinkedContainer={model.canUnlinkDocumentLink}
          containerName={model.containerName}
          containerNamesById={model.containerNamesById}
          documentInfo={model.documentInfo}
          documentSummaryError={model.documentSummaryError}
          idPrefix={model.tabIdPrefix}
          isLoadingDocumentSummary={model.isLoadingDocumentSummary}
          linkedContainerIds={model.linkedContainerIds}
          localId={params.localId}
          nodes={params.nodes}
          openBlobBrowserRoute={params.openBlobBrowserRoute}
          setSelectedId={params.setSelectedId}
          unlinkDocument={params.unlinkDocument}
        />
      </div>
    </MiniAppPanel>
  );
}
