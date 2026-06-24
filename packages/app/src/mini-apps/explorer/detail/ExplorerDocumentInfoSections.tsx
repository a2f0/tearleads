import type { DocumentInfo } from "@tearleads/client-sdk";
import {
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { MiniAppInfoTable } from "../../../components/shared/MiniAppTable";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../document-types/projectors";
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
import { compactId } from "./compactId";

export type OpenBlobBrowserRoute = (input?: {
  blobId?: string | null | undefined;
  storageKey?: string | null | undefined;
}) => void;

type DocumentInfoAttachment = DocumentInfo["attachments"][number];
type DocumentInfoRemoteAttachmentBinding = NonNullable<
  DocumentInfo["remoteInfo"]
>["activeAttachmentBindings"][number];

interface LocalDocumentInfoAttachmentRow {
  attachment: DocumentInfoAttachment;
  remoteBinding: DocumentInfoRemoteAttachmentBinding | null;
  state: "local" | "local-remote" | "pending";
}

interface RemoteDocumentInfoAttachmentRow {
  binding: DocumentInfoRemoteAttachmentBinding;
  state: "remote";
}

function getAttachmentRemoteBindingKey(input: {
  blobId: string | null;
  slotId: string;
}): string | null {
  return input.blobId ? `${input.slotId}\u0000${input.blobId}` : null;
}

function getExplorerDocumentInfoAttachmentRows(input: {
  attachments: ReadonlyArray<DocumentInfoAttachment>;
  remoteBindings: ReadonlyArray<DocumentInfoRemoteAttachmentBinding>;
}): {
  localRows: LocalDocumentInfoAttachmentRow[];
  remoteRows: RemoteDocumentInfoAttachmentRow[];
} {
  const matchedRemoteBindingIds = new Set<string>();
  const remoteBindingsByKey = new Map<
    string,
    DocumentInfoRemoteAttachmentBinding[]
  >();

  for (const binding of input.remoteBindings) {
    const key = getAttachmentRemoteBindingKey(binding);
    if (key) {
      const bindings = remoteBindingsByKey.get(key);
      if (bindings) {
        bindings.push(binding);
      } else {
        remoteBindingsByKey.set(key, [binding]);
      }
    }
  }

  const localRows = input.attachments.map(
    (attachment): LocalDocumentInfoAttachmentRow => {
      const key =
        attachment.attachmentKind === "local"
          ? getAttachmentRemoteBindingKey(attachment)
          : null;
      const bindings = key ? remoteBindingsByKey.get(key) : null;
      const remoteBinding = bindings?.shift() ?? null;
      if (remoteBinding) {
        matchedRemoteBindingIds.add(remoteBinding.bindingId);
      }

      return {
        attachment,
        remoteBinding: remoteBinding ?? null,
        state: remoteBinding ? "local-remote" : attachment.attachmentKind,
      };
    },
  );

  return {
    localRows,
    remoteRows: input.remoteBindings
      .filter((binding) => !matchedRemoteBindingIds.has(binding.bindingId))
      .map((binding) => ({ binding, state: "remote" })),
  };
}

function getDocumentTypeLabel(documentKind: StoredDocumentKind | null): string {
  return documentKind
    ? getStoredDocumentTypeLabel(
        documentKind,
        APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      )
    : "-";
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

export function ExplorerDocumentInfoLocalSecuritySection(params: {
  documentInfo: DocumentInfo | null;
}) {
  const local = params.documentInfo?.local;
  const bundleState = local
    ? getExplorerDocumentInfoBundleStateLabel({
        hasContentKeyBundle: local.hasContentKeyBundle,
        hasDocumentKekTargets: local.hasDocumentKekTargets,
        hasDocumentManifestBundle: local.hasDocumentManifestBundle,
      })
    : "-";

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoLocalSecurityHeading}
    >
      <MiniAppInfoTable>
        <tbody>
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
  const contributors = params.documentInfo?.remoteInfo?.contributors ?? [];
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

export function ExplorerDocumentInfoRemoteSecuritySection(params: {
  documentInfo: DocumentInfo;
}) {
  const remoteInfo = params.documentInfo.remoteInfo;
  if (!remoteInfo) {
    return (
      <MiniAppInfoSection
        heading={EXPLORER_LABELS.documentInfoRemoteSecurityHeading}
      >
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoRemoteInfo}
        </MiniAppStatus>
      </MiniAppInfoSection>
    );
  }

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoRemoteSecurityHeading}
    >
      <MiniAppInfoTable>
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
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}

export function ExplorerDocumentInfoAuthorizingContainersSection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  documentInfo: DocumentInfo;
}) {
  const remoteInfo = params.documentInfo.remoteInfo;
  const rows = remoteInfo?.authorizingContainerPaths ?? [];

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoAuthorizingContainersHeading}
    >
      {rows.length === 0 ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoAuthorizingContainers}
        </MiniAppStatus>
      ) : (
        <MiniAppInfoTable>
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
        </MiniAppInfoTable>
      )}
    </MiniAppInfoSection>
  );
}

export function ExplorerDocumentInfoAttachmentsSection(params: {
  documentInfo: DocumentInfo;
  openBlobBrowserRoute: OpenBlobBrowserRoute;
}) {
  const { attachments, remoteInfo } = params.documentInfo;
  const remoteBindings = remoteInfo?.activeAttachmentBindings ?? [];
  const { localRows, remoteRows } = getExplorerDocumentInfoAttachmentRows({
    attachments,
    remoteBindings,
  });
  const hasRows = localRows.length > 0 || remoteRows.length > 0;

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoAttachmentsHeading}
    >
      {!hasRows ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoAttachments}
        </MiniAppStatus>
      ) : (
        <MiniAppInfoTable>
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
            {localRows.map((row) => {
              const { attachment, remoteBinding } = row;
              const time = attachment.createdAt ?? attachment.updatedAt;
              return (
                <tr
                  key={`${row.state}:${attachment.slotId}:${attachment.blobId ?? ""}:${attachment.storageKey}`}
                >
                  <td title={remoteBinding?.bindingId ?? undefined}>
                    {getExplorerDocumentInfoAttachmentKindLabel(row.state)}
                  </td>
                  <td title={attachment.slotId}>
                    {compactId(attachment.slotId)}
                  </td>
                  <td title={attachment.blobId ?? undefined}>
                    <MiniAppButton
                      disabled={!attachment.blobId && !attachment.storageKey}
                      variant="ghost"
                      onClick={() => {
                        params.openBlobBrowserRoute({
                          blobId: attachment.blobId,
                          storageKey: attachment.storageKey,
                        });
                      }}
                    >
                      {compactId(attachment.blobId ?? attachment.storageKey)}
                    </MiniAppButton>
                  </td>
                  <td
                    title={
                      remoteBinding
                        ? `${attachment.storageKey} ${remoteBinding.bindingId}`
                        : attachment.storageKey
                    }
                  >
                    {attachment.name ?? attachment.mimeType ?? "-"}
                  </td>
                  <td>{formatByteLength(attachment.byteLength)}</td>
                  <td title={time ?? undefined}>
                    {formatMiniAppDateTime(time, { emptyFallback: "-" })}
                  </td>
                </tr>
              );
            })}
            {remoteRows.map(({ binding, state }) => (
              <tr key={`remote:${binding.bindingId}`}>
                <td>{getExplorerDocumentInfoAttachmentKindLabel(state)}</td>
                <td title={binding.slotId}>{compactId(binding.slotId)}</td>
                <td title={binding.blobId}>
                  <MiniAppButton
                    variant="ghost"
                    onClick={() => {
                      params.openBlobBrowserRoute({ blobId: binding.blobId });
                    }}
                  >
                    {compactId(binding.blobId)}
                  </MiniAppButton>
                </td>
                <td title={binding.bindingId}>
                  {compactId(binding.bindingId)}
                </td>
                <td>-</td>
                <td>-</td>
              </tr>
            ))}
          </tbody>
        </MiniAppInfoTable>
      )}
    </MiniAppInfoSection>
  );
}
