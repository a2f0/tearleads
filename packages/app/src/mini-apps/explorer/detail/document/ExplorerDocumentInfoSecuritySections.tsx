import type { DocumentInfo } from "@tearleads/client-sdk";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppKeyValueList,
  MiniAppKeyValueRow,
} from "../../../../components/mini-app/MiniAppTable";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoBundleStateLabel,
  getExplorerDocumentInfoLinkedContainersLabel,
  getExplorerDocumentInfoManifestHistoryLabel,
  getExplorerDocumentInfoTargetCountsLabel,
} from "../../labels";
import { ExplorerInfoIdRow } from "../ExplorerInfoIdRow";

function ExplorerDocumentInfoLocalSecuritySection(params: {
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
      <MiniAppKeyValueList>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.documentInfoAccessEpochRow}>
          {local?.accessEpoch != null ? String(local.accessEpoch) : "-"}
        </MiniAppKeyValueRow>
        <ExplorerInfoIdRow
          label={EXPLORER_LABELS.documentInfoAccessStateHashRow}
          value={local?.accessStateHash}
        />
        <ExplorerInfoIdRow
          label={EXPLORER_LABELS.documentInfoLastCommitRow}
          value={local?.lastCommitLsn}
        />
        <ExplorerInfoIdRow
          label={EXPLORER_LABELS.documentInfoLocalManifestHashRow}
          value={local?.localDocumentManifestHash}
        />
        <MiniAppKeyValueRow label={EXPLORER_LABELS.documentInfoBundleStateRow}>
          {bundleState}
        </MiniAppKeyValueRow>
      </MiniAppKeyValueList>
    </MiniAppInfoSection>
  );
}

function ExplorerDocumentInfoRemoteSecuritySection(params: {
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
      <MiniAppKeyValueList>
        <ExplorerInfoIdRow
          label={EXPLORER_LABELS.documentInfoCurrentManifestHashRow}
          value={remoteInfo.currentManifestHash}
        />
        <ExplorerInfoIdRow
          label={EXPLORER_LABELS.documentInfoPreviousManifestHashRow}
          value={remoteInfo.previousManifestHash}
        />
        <MiniAppKeyValueRow label={EXPLORER_LABELS.documentInfoAccessEpochRow}>
          {remoteInfo.manifestEpoch != null
            ? String(remoteInfo.manifestEpoch)
            : "-"}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.documentInfoDocumentManifestHistoryRow}
        >
          {getExplorerDocumentInfoManifestHistoryLabel({
            documentContainerManifestHistoryCount:
              remoteInfo.documentContainerManifestHistoryCount,
            documentManifestHistoryCount:
              remoteInfo.documentManifestHistoryCount,
          })}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.documentInfoLinkedContainersRow}
        >
          {getExplorerDocumentInfoLinkedContainersLabel({
            linkedContainerKeyEpochCount:
              remoteInfo.linkedContainerKeyEpochCount,
            linkedContainerManifestCount:
              remoteInfo.linkedContainerManifestCount,
          })}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.documentInfoContentKeyEpochRow}
        >
          {String(remoteInfo.contentKeyEpoch)}
        </MiniAppKeyValueRow>
        <ExplorerInfoIdRow
          label={EXPLORER_LABELS.documentInfoContentKeyHashRow}
          value={remoteInfo.contentKeyTargetHash}
        />
        <ExplorerInfoIdRow
          label={EXPLORER_LABELS.documentInfoDocumentKeyHashRow}
          value={remoteInfo.documentKeyTargetHash}
        />
        <MiniAppKeyValueRow label={EXPLORER_LABELS.documentInfoTargetCountRow}>
          {getExplorerDocumentInfoTargetCountsLabel({
            contentKeyTargetCount: remoteInfo.contentKeyTargetCount,
            documentKekTargetCount: remoteInfo.documentKekTargetCount,
          })}
        </MiniAppKeyValueRow>
      </MiniAppKeyValueList>
    </MiniAppInfoSection>
  );
}

export function ExplorerDocumentInfoSecurityTab(params: {
  documentInfo: DocumentInfo | null;
}) {
  return (
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
  );
}
