import type { ContainerNode, DocumentInfo } from "@tearleads/client-sdk";
import {
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "@tearleads/client-sdk/documents";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { APP_DOCUMENT_PROJECTOR_REGISTRY } from "../../../document-types/projectors";
import { formatByteLength } from "../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoAttachmentKindLabel,
  getExplorerDocumentInfoBundleStateLabel,
  getExplorerDocumentInfoEpochLabel,
  getExplorerDocumentInfoLinkedContainersLabel,
  getExplorerDocumentInfoManifestHistoryLabel,
  getExplorerDocumentInfoPathLengthLabel,
  getExplorerDocumentInfoPendingChangesLabel,
  getExplorerDocumentInfoTargetCountsLabel,
} from "../labels";

interface Props {
  containerId: string;
  documentTitle: string | undefined;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  localId: string;
  nodes: ReadonlyArray<ContainerNode>;
  onBackToDocument: () => void;
}

function compactId(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return value.length <= 18
    ? value
    : `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getDocumentTypeLabel(documentKind: StoredDocumentKind | null): string {
  return documentKind
    ? getStoredDocumentTypeLabel(documentKind, APP_DOCUMENT_PROJECTOR_REGISTRY)
    : "-";
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

function DocumentInfoRow(params: {
  children: string;
  label: string;
  title?: string | null | undefined;
}) {
  return (
    <tr>
      <th>{params.label}</th>
      <td title={params.title ?? undefined}>{params.children}</td>
    </tr>
  );
}

function ExplorerDocumentInfoLocalSection(params: {
  containerName: string | null;
  documentInfo: DocumentInfo | null;
  localId: string;
}) {
  const { containerName, documentInfo, localId } = params;
  const local = documentInfo?.local;
  const bundleState = local
    ? getExplorerDocumentInfoBundleStateLabel({
        hasContentKeyBundle: local.hasContentKeyBundle,
        hasDocumentKekTargets: local.hasDocumentKekTargets,
        hasDocumentManifestBundle: local.hasDocumentManifestBundle,
      })
    : "-";
  const pendingChanges = local
    ? getExplorerDocumentInfoPendingChangesLabel({
        pendingAttachmentByteLength: local.pendingAttachmentByteLength,
        pendingAttachmentCount: local.pendingAttachmentCount,
        pendingUpdateCount: local.pendingUpdateCount,
      })
    : "-";

  return (
    <section className="explorer-info-section">
      <h3>{EXPLORER_LABELS.documentInfoLocalDetailsHeading}</h3>
      <table className="explorer-info-table">
        <tbody>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoIdRow}
            title={localId}
          >
            {compactId(localId)}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoDocumentIdRow}
            title={local?.documentId}
          >
            {compactId(local?.documentId)}
          </DocumentInfoRow>
          <DocumentInfoRow label={EXPLORER_LABELS.documentInfoTypeRow}>
            {getDocumentTypeLabel(local?.documentKind ?? null)}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoContainerRow}
            title={local?.containerId}
          >
            {containerName ?? compactId(local?.containerId)}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoUpdatedRow}
            title={local?.updatedAt}
          >
            {formatMiniAppDateTime(local?.updatedAt ?? null, {
              emptyFallback: "-",
            })}
          </DocumentInfoRow>
          <DocumentInfoRow label={EXPLORER_LABELS.documentInfoAccessEpochRow}>
            {local?.accessEpoch ? String(local.accessEpoch) : "-"}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoAccessStateHashRow}
            title={local?.accessStateHash}
          >
            {compactId(local?.accessStateHash)}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoLastCommitRow}
            title={local?.lastCommitLsn}
          >
            {compactId(local?.lastCommitLsn)}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoLocalManifestHashRow}
            title={local?.localDocumentManifestHash}
          >
            {compactId(local?.localDocumentManifestHash)}
          </DocumentInfoRow>
          <DocumentInfoRow label={EXPLORER_LABELS.documentInfoBundleStateRow}>
            {bundleState}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoPendingChangesRow}
          >
            {pendingChanges}
          </DocumentInfoRow>
        </tbody>
      </table>
    </section>
  );
}

function ExplorerDocumentInfoRemoteSecuritySection(params: {
  documentInfo: DocumentInfo;
}) {
  const remoteInfo = params.documentInfo.remoteInfo;
  if (!remoteInfo) {
    return (
      <section className="explorer-info-section">
        <h3>{EXPLORER_LABELS.documentInfoRemoteSecurityHeading}</h3>
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoRemoteInfo}
        </MiniAppStatus>
      </section>
    );
  }

  return (
    <section className="explorer-info-section">
      <h3>{EXPLORER_LABELS.documentInfoRemoteSecurityHeading}</h3>
      <table className="explorer-info-table">
        <tbody>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoCurrentManifestHashRow}
            title={remoteInfo.currentManifestHash}
          >
            {compactId(remoteInfo.currentManifestHash)}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoPreviousManifestHashRow}
            title={remoteInfo.previousManifestHash}
          >
            {compactId(remoteInfo.previousManifestHash)}
          </DocumentInfoRow>
          <DocumentInfoRow label={EXPLORER_LABELS.documentInfoAccessEpochRow}>
            {remoteInfo.manifestEpoch ? String(remoteInfo.manifestEpoch) : "-"}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoDocumentManifestHistoryRow}
          >
            {getExplorerDocumentInfoManifestHistoryLabel({
              documentContainerManifestHistoryCount:
                remoteInfo.documentContainerManifestHistoryCount,
              documentManifestHistoryCount:
                remoteInfo.documentManifestHistoryCount,
            })}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoLinkedContainersRow}
          >
            {getExplorerDocumentInfoLinkedContainersLabel({
              linkedContainerKeyEpochCount:
                remoteInfo.linkedContainerKeyEpochCount,
              linkedContainerManifestCount:
                remoteInfo.linkedContainerManifestCount,
            })}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoContentKeyEpochRow}
          >
            {String(remoteInfo.contentKeyEpoch)}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoContentKeyHashRow}
            title={remoteInfo.contentKeyTargetHash}
          >
            {compactId(remoteInfo.contentKeyTargetHash)}
          </DocumentInfoRow>
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoDocumentKeyHashRow}
            title={remoteInfo.documentKeyTargetHash}
          >
            {compactId(remoteInfo.documentKeyTargetHash)}
          </DocumentInfoRow>
          <DocumentInfoRow label={EXPLORER_LABELS.documentInfoTargetCountRow}>
            {getExplorerDocumentInfoTargetCountsLabel({
              contentKeyTargetCount: remoteInfo.contentKeyTargetCount,
              documentKekTargetCount: remoteInfo.documentKekTargetCount,
            })}
          </DocumentInfoRow>
        </tbody>
      </table>
    </section>
  );
}

function ExplorerDocumentInfoAuthorizingContainersSection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  documentInfo: DocumentInfo;
}) {
  const remoteInfo = params.documentInfo.remoteInfo;
  const rows = remoteInfo?.authorizingContainerPaths ?? [];

  return (
    <section className="explorer-info-section">
      <h3>{EXPLORER_LABELS.documentInfoAuthorizingContainersHeading}</h3>
      {rows.length === 0 ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoAuthorizingContainers}
        </MiniAppStatus>
      ) : (
        <table className="explorer-info-table">
          <thead>
            <tr>
              <th>{EXPLORER_LABELS.documentInfoContainerColumn}</th>
              <th>{EXPLORER_LABELS.containerInfoLaneColumn}</th>
              <th>{EXPLORER_LABELS.containerInfoCursorColumn}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.containerId}:${row.leafManifestHash ?? ""}`}>
                <td title={row.containerId}>
                  {params.containerNamesById.get(row.containerId) ??
                    compactId(row.containerId)}
                </td>
                <td>
                  {getExplorerDocumentInfoPathLengthLabel(row.pathLength)}
                </td>
                <td>
                  <div title={row.leafManifestHash ?? undefined}>
                    {compactId(row.leafManifestHash)}
                  </div>
                  <code title={row.containerKeyEpochId ?? undefined}>
                    {row.containerKeyEpoch
                      ? getExplorerDocumentInfoEpochLabel(row.containerKeyEpoch)
                      : "-"}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ExplorerDocumentInfoAttachmentsSection(params: {
  documentInfo: DocumentInfo;
}) {
  const { attachments, remoteInfo } = params.documentInfo;
  const remoteBindings = remoteInfo?.activeAttachmentBindings ?? [];
  const hasRows = attachments.length > 0 || remoteBindings.length > 0;

  return (
    <section className="explorer-info-section">
      <h3>{EXPLORER_LABELS.documentInfoAttachmentsHeading}</h3>
      {!hasRows ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoAttachments}
        </MiniAppStatus>
      ) : (
        <table className="explorer-info-table">
          <thead>
            <tr>
              <th>{EXPLORER_LABELS.documentInfoAttachmentKindColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentSlotColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentBlobColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentNameColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentSizeColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentTimeColumn}</th>
            </tr>
          </thead>
          <tbody>
            {attachments.map((attachment) => {
              const time = attachment.createdAt ?? attachment.updatedAt;
              return (
                <tr
                  key={`${attachment.attachmentKind}:${attachment.slotId}:${attachment.storageKey}`}
                >
                  <td>
                    {getExplorerDocumentInfoAttachmentKindLabel(
                      attachment.attachmentKind,
                    )}
                  </td>
                  <td title={attachment.slotId}>
                    {compactId(attachment.slotId)}
                  </td>
                  <td title={attachment.blobId ?? undefined}>
                    {compactId(attachment.blobId)}
                  </td>
                  <td title={attachment.storageKey}>
                    {attachment.name ?? attachment.mimeType ?? "-"}
                  </td>
                  <td>{formatByteLength(attachment.byteLength)}</td>
                  <td title={time ?? undefined}>
                    {formatMiniAppDateTime(time, { emptyFallback: "-" })}
                  </td>
                </tr>
              );
            })}
            {remoteBindings.map((binding) => (
              <tr key={`remote:${binding.bindingId}`}>
                <td>{getExplorerDocumentInfoAttachmentKindLabel("remote")}</td>
                <td title={binding.slotId}>{compactId(binding.slotId)}</td>
                <td title={binding.blobId}>{compactId(binding.blobId)}</td>
                <td title={binding.bindingId}>
                  {compactId(binding.bindingId)}
                </td>
                <td>-</td>
                <td>-</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ExplorerDocumentInfoPanel(params: Props) {
  const {
    containerId,
    documentTitle,
    loadDocumentInfo,
    localId,
    nodes,
    onBackToDocument,
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
      <div className="explorer-detail-header">
        <div className="explorer-detail-copy">
          <strong>{EXPLORER_LABELS.documentInfoTitle}</strong>
          <span>{title}</span>
        </div>
        <MiniAppActions>
          <MiniAppButton onClick={onBackToDocument}>
            {EXPLORER_LABELS.documentInfoBackAction}
          </MiniAppButton>
        </MiniAppActions>
      </div>
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
            />
          </>
        ) : null}
      </div>
    </MiniAppPanel>
  );
}
