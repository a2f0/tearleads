import type { DocumentInfo } from "@symcrypt/client-sdk";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppKeyValueTable,
} from "../../../../components/mini-app/MiniAppTable";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoBundleStateLabel,
  getExplorerDocumentInfoLinkedContainersLabel,
  getExplorerDocumentInfoManifestHistoryLabel,
  getExplorerDocumentInfoTargetCountsLabel,
} from "../../labels";
import { compactId } from "../compactId";

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
      <MiniAppKeyValueTable>
        <tbody>
          <MiniAppInfoRow label={EXPLORER_LABELS.documentInfoAccessEpochRow}>
            {local?.accessEpoch != null ? String(local.accessEpoch) : "-"}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoAccessStateHashRow}
            title={local?.accessStateHash}
          >
            {compactId(local?.accessStateHash)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoLastCommitRow}
            title={local?.lastCommitLsn}
          >
            {compactId(local?.lastCommitLsn)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoLocalManifestHashRow}
            title={local?.localDocumentManifestHash}
          >
            {compactId(local?.localDocumentManifestHash)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.documentInfoBundleStateRow}>
            {bundleState}
          </MiniAppInfoRow>
        </tbody>
      </MiniAppKeyValueTable>
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
      <MiniAppKeyValueTable>
        <tbody>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoCurrentManifestHashRow}
            title={remoteInfo.currentManifestHash}
          >
            {compactId(remoteInfo.currentManifestHash)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoPreviousManifestHashRow}
            title={remoteInfo.previousManifestHash}
          >
            {compactId(remoteInfo.previousManifestHash)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.documentInfoAccessEpochRow}>
            {remoteInfo.manifestEpoch != null
              ? String(remoteInfo.manifestEpoch)
              : "-"}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoDocumentManifestHistoryRow}
          >
            {getExplorerDocumentInfoManifestHistoryLabel({
              documentContainerManifestHistoryCount:
                remoteInfo.documentContainerManifestHistoryCount,
              documentManifestHistoryCount:
                remoteInfo.documentManifestHistoryCount,
            })}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoLinkedContainersRow}
          >
            {getExplorerDocumentInfoLinkedContainersLabel({
              linkedContainerKeyEpochCount:
                remoteInfo.linkedContainerKeyEpochCount,
              linkedContainerManifestCount:
                remoteInfo.linkedContainerManifestCount,
            })}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoContentKeyEpochRow}
          >
            {String(remoteInfo.contentKeyEpoch)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoContentKeyHashRow}
            title={remoteInfo.contentKeyTargetHash}
          >
            {compactId(remoteInfo.contentKeyTargetHash)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoDocumentKeyHashRow}
            title={remoteInfo.documentKeyTargetHash}
          >
            {compactId(remoteInfo.documentKeyTargetHash)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.documentInfoTargetCountRow}>
            {getExplorerDocumentInfoTargetCountsLabel({
              contentKeyTargetCount: remoteInfo.contentKeyTargetCount,
              documentKekTargetCount: remoteInfo.documentKekTargetCount,
            })}
          </MiniAppInfoRow>
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppInfoSection>
  );
}
