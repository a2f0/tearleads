import type { ContainerNode, DocumentInfo } from "@tearleads/client-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { EXPLORER_LABELS } from "../labels";
import {
  compactId,
  ExplorerDocumentInfoAttachmentsSection,
  ExplorerDocumentInfoAuthorizingContainersSection,
  ExplorerDocumentInfoLocalSection,
  ExplorerDocumentInfoRemoteSecuritySection,
  type OpenBlobBrowserRoute,
} from "./ExplorerDocumentInfoSections";

interface Props {
  containerId: string;
  documentTitle: string | undefined;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  localId: string;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToDocument: () => void;
  openBlobBrowserRoute: OpenBlobBrowserRoute;
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function ExplorerDocumentInfoPanel(params: Props) {
  const {
    containerId,
    documentTitle,
    loadDocumentInfo,
    localId,
    nodes,
    onBackToDocument,
    openBlobBrowserRoute,
  } = params;
  const { documentInfo, documentInfoError, isLoadingDocumentInfo } =
    useExplorerDocumentInfo({ loadDocumentInfo, localId });
  const containerNamesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.name])),
    [nodes],
  );
  const containerName =
    containerNamesById.get(documentInfo?.local.containerId ?? containerId) ??
    null;
  const title =
    documentTitle ?? documentInfo?.local.title ?? compactId(localId);

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--document-info"
      key={localId}
      scroll
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.documentInfoTitle}</strong>
          <span>{title}</span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton onClick={onBackToDocument}>
            {EXPLORER_LABELS.documentInfoBackAction}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <div className="explorer-info">
        <ExplorerDocumentInfoLocalSection
          containerName={containerName}
          documentInfo={documentInfo}
          localId={localId}
        />
        {isLoadingDocumentInfo && !documentInfo ? (
          <MiniAppStatus>{EXPLORER_LABELS.documentInfoLoading}</MiniAppStatus>
        ) : null}
        {documentInfoError ? (
          <MiniAppStatus tone="error">{documentInfoError}</MiniAppStatus>
        ) : null}
        {documentInfo ? (
          <>
            <ExplorerDocumentInfoRemoteSecuritySection
              documentInfo={documentInfo}
            />
            <ExplorerDocumentInfoAuthorizingContainersSection
              containerNamesById={containerNamesById}
              documentInfo={documentInfo}
            />
            <ExplorerDocumentInfoAttachmentsSection
              documentInfo={documentInfo}
              openBlobBrowserRoute={openBlobBrowserRoute}
            />
          </>
        ) : null}
      </div>
    </MiniAppPanel>
  );
}
