import type {
  ContainerNode,
  DocumentInfo,
  DocumentSummary,
} from "@symcrypt/client-sdk";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import type { ExplorerDocumentAttributionRangesLoader } from "../../../../stores/explorer/documentInfo";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";
import type { ExplorerAttributionProfileHydrationRequester } from "../../hooks/explorerAttributionReadModel";
import { EXPLORER_LABELS } from "../../labels";
import { canWriteDocumentSummary } from "../../model/containerRules";
import { getDocumentLinkedContainerIds } from "../../model/targetOptions";
import type { ExplorerAttributionUserLabelResolver } from "../attributionDisplay";
import { compactId } from "../compactId";
import {
  ExplorerDocumentInfoAttachmentsSection,
  type OpenBlobBrowserRoute,
} from "./ExplorerDocumentInfoAttachmentsSection";
import { ExplorerDocumentInfoAuthorizingContainersSection } from "./ExplorerDocumentInfoContainersSection";
import { ExplorerDocumentInfoEditRangesSection } from "./ExplorerDocumentInfoEditRangesSection";
import {
  ExplorerDocumentInfoBlameSection,
  ExplorerDocumentInfoCharacterBlameSection,
  ExplorerDocumentInfoContributorsSection,
  ExplorerDocumentInfoFieldBlameSection,
  ExplorerDocumentInfoGeneralSection,
} from "./ExplorerDocumentInfoGeneralSections";
import {
  ExplorerDocumentInfoLocalSecuritySection,
  ExplorerDocumentInfoRemoteSecuritySection,
} from "./ExplorerDocumentInfoSecuritySections";
import { ExplorerLinkedContainerSection } from "./ExplorerLinkedContainers";
import { useExplorerDocumentInfo } from "./useExplorerDocumentInfo";

type DocumentInfoTabId = "general" | "links" | "blobs" | "security";

const DOCUMENT_INFO_TABS: ReadonlyArray<
  MiniAppTabDescriptor<DocumentInfoTabId>
> = [
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
  attributionUserLabelResolver?:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  fallbackDocumentSummary: DocumentSummary | null;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentAttributionRanges: ExplorerDocumentAttributionRangesLoader;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  localId: string;
  nodes: ReadonlyArray<ContainerNode>;
  openBlobBrowserRoute: OpenBlobBrowserRoute;
  requestAttributionProfileHydration: ExplorerAttributionProfileHydrationRequester;
  setSelectedId: (id: string | null) => void;
  showDocumentEditRanges: boolean;
  showLinkedDocumentActivationControls: boolean;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
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
    <MiniAppTabList
      activeTab={params.activeTab}
      idPrefix={params.idPrefix}
      label={EXPLORER_LABELS.documentInfoTabsLabel}
      onSelect={params.setActiveTab}
      tabs={DOCUMENT_INFO_TABS}
    />
  );
}

function ExplorerDocumentInfoTabPanel(params: {
  activeTab: DocumentInfoTabId;
  activeContainerId: string | null;
  attributionUserLabelResolver?:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  activateLinkedContainer: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateLinkedContainer: boolean;
  canUnlinkLinkedContainer: boolean;
  containerName: string | null;
  containersById: ReadonlyMap<string, ContainerNode>;
  documentInfo: DocumentInfo | null;
  documentSummaryError: string | null;
  idPrefix: string;
  isLoadingDocumentSummary: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  loadDocumentAttributionRanges: ExplorerDocumentAttributionRangesLoader;
  localId: string;
  nodes: ReadonlyArray<ContainerNode>;
  openBlobBrowserRoute: OpenBlobBrowserRoute;
  requestAttributionProfileHydration: ExplorerAttributionProfileHydrationRequester;
  setSelectedId: (id: string | null) => void;
  showDocumentEditRanges: boolean;
  showLinkedDocumentActivationControls: boolean;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  return (
    <MiniAppTabPanel
      activeTab={params.activeTab}
      className="explorer-info-tab-panel"
      idPrefix={params.idPrefix}
    >
      {params.activeTab === "general" ? (
        <>
          <ExplorerDocumentInfoGeneralSection
            containerName={params.containerName}
            documentInfo={params.documentInfo}
            localId={params.localId}
          />
          <ExplorerDocumentInfoContributorsSection
            attributionUserLabelResolver={params.attributionUserLabelResolver}
            documentInfo={params.documentInfo}
          />
          {params.showDocumentEditRanges ? (
            <ExplorerDocumentInfoEditRangesSection
              attributionUserLabelResolver={params.attributionUserLabelResolver}
              documentInfo={params.documentInfo}
              loadDocumentAttributionRanges={
                params.loadDocumentAttributionRanges
              }
              requestAttributionProfileHydration={
                params.requestAttributionProfileHydration
              }
            />
          ) : null}
          <ExplorerDocumentInfoCharacterBlameSection
            attributionUserLabelResolver={params.attributionUserLabelResolver}
            documentInfo={params.documentInfo}
          />
          <ExplorerDocumentInfoBlameSection
            attributionUserLabelResolver={params.attributionUserLabelResolver}
            documentInfo={params.documentInfo}
          />
          <ExplorerDocumentInfoFieldBlameSection
            attributionUserLabelResolver={params.attributionUserLabelResolver}
            documentInfo={params.documentInfo}
          />
        </>
      ) : null}
      {params.activeTab === "links" ? (
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
            showActivationControls={params.showLinkedDocumentActivationControls}
            unlinkDocument={params.unlinkDocument}
          />
          {params.documentInfo ? (
            <ExplorerDocumentInfoAuthorizingContainersSection
              containersById={params.containersById}
              documentInfo={params.documentInfo}
            />
          ) : null}
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
    </MiniAppTabPanel>
  );
}

function useExplorerDocumentInfoPanelState(params: Props) {
  const tabIdPrefix = useId();
  const [activeTab, setActiveTab] = useState<DocumentInfoTabId>("general");
  const { documentInfo, documentInfoError, isLoadingDocumentInfo } =
    useExplorerDocumentInfo({
      load: params.loadDocumentInfo,
      localId: params.localId,
    });
  const { documentSummary, documentSummaryError, isLoadingDocumentSummary } =
    useExplorerDocumentSummary({
      fallbackDocumentSummary: params.fallbackDocumentSummary,
      loadDocumentSummary: params.loadDocumentSummary,
      localId: params.localId,
    });
  // First occurrence wins on duplicate ids, matching getLinkedContainerDetails.
  const containersById = useMemo(() => {
    const byId = new Map<string, ContainerNode>();
    for (const node of params.nodes) {
      if (!byId.has(node.id)) {
        byId.set(node.id, node);
      }
    }
    return byId;
  }, [params.nodes]);
  const containerName =
    containersById.get(documentInfo?.local.containerId ?? params.containerId)
      ?.name ?? null;
  const title =
    params.documentTitle ??
    documentInfo?.local.title ??
    compactId(params.localId);
  const linkedContainerIds = getDocumentInfoLinkedContainerIds({
    documentInfo,
    documentSummary,
    linkedContainerIdsByDocumentId: params.linkedContainerIdsByDocumentId,
  });
  const hasRemoteDocument =
    !!documentSummary?.documentId || !!documentInfo?.local.documentId;
  const activeContainerId =
    documentSummary?.containerId ?? documentInfo?.local.containerId ?? null;
  const canActivateDocumentLink =
    params.canActivateLinkedContainer && hasRemoteDocument;
  const canUnlinkDocumentLink =
    params.canMutateDocumentLinks &&
    canWriteDocumentSummary(documentSummary) &&
    hasRemoteDocument &&
    linkedContainerIds.length > 1;

  useEffect(() => {
    setActiveTab("general");
  }, [params.localId]);

  useEffect(() => {
    if (!documentInfo?.remoteInfo) {
      return;
    }
    const contributorUserIds = documentInfo.remoteInfo.contributors.map(
      (contributor) => contributor.writerUserId,
    );
    if (contributorUserIds.length === 0) {
      return;
    }
    params.requestAttributionProfileHydration({
      contributorUserIds,
      documentId: documentInfo.local.documentId ?? params.localId,
    });
  }, [documentInfo, params.requestAttributionProfileHydration]);

  return {
    activeTab,
    activeContainerId,
    canActivateDocumentLink,
    canUnlinkDocumentLink,
    containerName,
    containersById,
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
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.documentInfoTitle}</strong>
          <span>{model.title}</span>
        </MiniAppHeaderCopy>
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
          activeTab={model.activeTab}
          activeContainerId={model.activeContainerId}
          attributionUserLabelResolver={params.attributionUserLabelResolver}
          activateLinkedContainer={params.activateLinkedContainer}
          canActivateLinkedContainer={model.canActivateDocumentLink}
          canUnlinkLinkedContainer={model.canUnlinkDocumentLink}
          containerName={model.containerName}
          containersById={model.containersById}
          documentInfo={model.documentInfo}
          documentSummaryError={model.documentSummaryError}
          idPrefix={model.tabIdPrefix}
          isLoadingDocumentSummary={model.isLoadingDocumentSummary}
          linkedContainerIds={model.linkedContainerIds}
          loadDocumentAttributionRanges={params.loadDocumentAttributionRanges}
          localId={params.localId}
          nodes={params.nodes}
          openBlobBrowserRoute={params.openBlobBrowserRoute}
          requestAttributionProfileHydration={
            params.requestAttributionProfileHydration
          }
          setSelectedId={params.setSelectedId}
          showDocumentEditRanges={params.showDocumentEditRanges}
          showLinkedDocumentActivationControls={
            params.showLinkedDocumentActivationControls
          }
          unlinkDocument={params.unlinkDocument}
        />
      </div>
    </MiniAppPanel>
  );
}
