import type { DocumentInfo } from "@tearleads/client-sdk";
import {
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppInfoTable,
} from "../../../components/shared/MiniAppTable";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../document-types/projectors";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoPendingChangesLabel,
} from "../labels";
import { compactId } from "./compactId";

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
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoIdRow}
            title={localId}
          >
            {compactId(localId)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoDocumentIdRow}
            title={local?.documentId}
          >
            {compactId(local?.documentId)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.documentInfoTypeRow}>
            {getDocumentTypeLabel(local?.documentKind ?? null)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoContainerRow}
            title={local?.containerId}
          >
            {containerName ?? compactId(local?.containerId)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoUpdatedRow}
            title={local?.updatedAt}
          >
            {formatMiniAppDateTime(local?.updatedAt ?? null, {
              emptyFallback: "-",
            })}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.documentInfoPendingChangesRow}>
            {pendingChanges}
          </MiniAppInfoRow>
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
              <MiniAppInfoRow
                key={contributor.writerKeyFingerprint}
                label={compactId(contributor.writerKeyFingerprint)}
                title={`${contributor.writerUserId} · ${contributor.writerKeyFingerprint}`}
              >
                {formatContributorEdits(contributor)}
              </MiniAppInfoRow>
            ))}
          </tbody>
        </MiniAppInfoTable>
      )}
    </MiniAppInfoSection>
  );
}

function formatCharacterCount(count: number): string {
  return `${count} ${
    count === 1
      ? EXPLORER_LABELS.documentInfoCharacterBlameCharacterSingular
      : EXPLORER_LABELS.documentInfoCharacterBlameCharacterPlural
  }`;
}

function formatBlameCharacters(writer: {
  characterCount: number;
  hasDirectAuthority: boolean;
}): string {
  const characters = formatCharacterCount(writer.characterCount);
  // A writer credited only via a rotate_baseline re-assertion is the first signed
  // uploader of those characters, not a proven author — flag that distinction.
  return writer.hasDirectAuthority
    ? characters
    : `${characters} ${EXPLORER_LABELS.documentInfoContributorReasserted}`;
}

export function ExplorerDocumentInfoCharacterBlameSection(params: {
  documentInfo: DocumentInfo | null;
}) {
  const blame = params.documentInfo?.remoteInfo?.characterBlame;
  // Per-writer authorship of the CURRENT text — the live-character counterpart to
  // the Contributors op-count rollup. Hidden when blame could not be computed (no
  // local snapshot, too large to scan, or unreadable) or the document is empty.
  // A document whose characters are all still unattributed (e.g. local edits the
  // attribution feed has not caught up to) keeps the section, surfacing that count.
  if (
    !blame ||
    (blame.writers.length === 0 && blame.unattributedCharacterCount === 0)
  ) {
    return null;
  }
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoCharacterBlameHeading}
    >
      <MiniAppInfoTable>
        <tbody>
          {blame.writers.map((writer) => (
            <MiniAppInfoRow
              key={writer.writerKeyFingerprint}
              label={compactId(writer.writerKeyFingerprint)}
              title={`${writer.writerUserId} · ${writer.writerKeyFingerprint}`}
            >
              {formatBlameCharacters(writer)}
            </MiniAppInfoRow>
          ))}
          {blame.unattributedCharacterCount > 0 ? (
            <MiniAppInfoRow
              label={EXPLORER_LABELS.documentInfoCharacterBlameUnattributed}
            >
              {formatCharacterCount(blame.unattributedCharacterCount)}
            </MiniAppInfoRow>
          ) : null}
        </tbody>
      </MiniAppInfoTable>
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
            <th>{EXPLORER_LABELS.documentInfoEditRangeUploadColumn}</th>
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
              <td title={segment.updateId}>{`#${segment.updateSequence}`}</td>
              <td>{getEditRangeAuthorityLabel(segment.authorityKind)}</td>
            </tr>
          ))}
        </tbody>
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}
