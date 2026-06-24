import type { DocumentInfo } from "@tearleads/client-sdk";
import {
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { MiniAppInfoTable } from "../../../components/shared/MiniAppTable";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../document-types/projectors";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoPendingChangesLabel,
} from "../labels";
import { compactId } from "./compactId";
import { DocumentInfoRow } from "./ExplorerDocumentInfoRow";

type DocumentInfoAttributionSegment = NonNullable<
  DocumentInfo["remoteInfo"]
>["attributionSegments"][number];

function getDocumentTypeLabel(documentKind: StoredDocumentKind | null): string {
  return documentKind
    ? getStoredDocumentTypeLabel(
        documentKind,
        APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      )
    : "-";
}

export function ExplorerDocumentInfoGeneralSection(params: {
  containerName: string | null;
  documentInfo: DocumentInfo | null;
  localId: string;
}) {
  const { containerName, documentInfo, localId } = params;
  const local = documentInfo?.local;
  const pendingChanges = local
    ? getExplorerDocumentInfoPendingChangesLabel({
        pendingAttachmentByteLength: local.pendingAttachmentByteLength,
        pendingAttachmentCount: local.pendingAttachmentCount,
        pendingUpdateCount: local.pendingUpdateCount,
      })
    : "-";

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.documentInfoGeneralHeading}>
      <MiniAppInfoTable>
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
          <DocumentInfoRow
            label={EXPLORER_LABELS.documentInfoPendingChangesRow}
          >
            {pendingChanges}
          </DocumentInfoRow>
        </tbody>
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}

function formatContributorEdits(contributor: {
  opCount: number;
  hasDirectAuthority: boolean;
}): string {
  const edits = `${contributor.opCount} ${
    contributor.opCount === 1
      ? EXPLORER_LABELS.documentInfoContributorEditSingular
      : EXPLORER_LABELS.documentInfoContributorEditPlural
  }`;
  // A contributor credited only via a rotate_baseline re-assertion is the first
  // signed uploader of those ops, not a proven author — flag that distinction.
  return contributor.hasDirectAuthority
    ? edits
    : `${edits} ${EXPLORER_LABELS.documentInfoContributorReasserted}`;
}

export function ExplorerDocumentInfoContributorsSection(params: {
  documentInfo: DocumentInfo | null;
}) {
  const remoteInfo = params.documentInfo?.remoteInfo;
  // Hide the section entirely for local-only/unsynced docs: we never fetched
  // attribution, so showing an empty "no attribution" state would be misleading.
  if (!remoteInfo) {
    return null;
  }
  const contributors = remoteInfo.contributors;
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoContributorsHeading}
    >
      {contributors.length === 0 ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoContributors}
        </MiniAppStatus>
      ) : (
        <MiniAppInfoTable>
          <tbody>
            {contributors.map((contributor) => (
              <DocumentInfoRow
                key={contributor.writerKeyFingerprint}
                label={compactId(contributor.writerKeyFingerprint)}
                title={`${contributor.writerUserId} · ${contributor.writerKeyFingerprint}`}
              >
                {formatContributorEdits(contributor)}
              </DocumentInfoRow>
            ))}
          </tbody>
        </MiniAppInfoTable>
      )}
    </MiniAppInfoSection>
  );
}

function getEditRangeAuthorityLabel(
  authorityKind: DocumentInfoAttributionSegment["authorityKind"],
): string {
  return authorityKind === "direct"
    ? EXPLORER_LABELS.documentInfoEditRangeAuthorityDirect
    : EXPLORER_LABELS.documentInfoEditRangeAuthorityReasserted;
}

export function ExplorerDocumentInfoEditRangesSection(params: {
  documentInfo: DocumentInfo | null;
}) {
  const remoteInfo = params.documentInfo?.remoteInfo;
  const segments = remoteInfo?.attributionSegments ?? [];
  // Granular drill-down behind the Contributors rollup. Hidden whenever there is
  // nothing to drill into (local-only/unsynced doc, or no attributed ranges) —
  // the Contributors section already carries the canonical empty state.
  if (!remoteInfo || segments.length === 0) {
    return null;
  }
  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.documentInfoEditRangesHeading}>
      <MiniAppInfoTable>
        <thead>
          <tr>
            <th>{EXPLORER_LABELS.documentInfoEditRangeWriterColumn}</th>
            <th>{EXPLORER_LABELS.documentInfoEditRangePeerColumn}</th>
            <th>{EXPLORER_LABELS.documentInfoEditRangeRangeColumn}</th>
            <th>{EXPLORER_LABELS.documentInfoEditRangeOpsColumn}</th>
            <th>{EXPLORER_LABELS.documentInfoEditRangeAuthorityColumn}</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => (
            <tr
              key={`${segment.peerId}:${segment.startCounter}:${segment.endCounter}`}
            >
              <td
                title={`${segment.writerUserId} · ${segment.writerKeyFingerprint}`}
              >
                {compactId(segment.writerKeyFingerprint)}
              </td>
              <td title={segment.peerId}>{compactId(segment.peerId)}</td>
              <td>{`${segment.startCounter}–${segment.endCounter}`}</td>
              <td>{String(segment.opCount)}</td>
              <td>{getEditRangeAuthorityLabel(segment.authorityKind)}</td>
            </tr>
          ))}
        </tbody>
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}
