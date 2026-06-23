import { formatByteLength } from "../../utils/formatByteLength";
import { EXPLORER_LABELS } from "./labelCatalog";

export { EXPLORER_LABELS };

const EXPLORER_COUNT_FORMATTER = new Intl.NumberFormat();
const EXPLORER_PLURAL_RULES = new Intl.PluralRules();

function getExplorerPluralLabel(
  value: number,
  labels: { one: string; other: string },
): string {
  return EXPLORER_PLURAL_RULES.select(value) === "one"
    ? labels.one
    : labels.other;
}

function formatExplorerCountLabel(
  value: number,
  labels: { one: string; other: string },
): string {
  return `${EXPLORER_COUNT_FORMATTER.format(value)} ${getExplorerPluralLabel(value, labels)}`;
}

export function getExplorerSyncBlobCountLabel(value: number): string {
  return formatExplorerCountLabel(value, {
    one: EXPLORER_LABELS.syncStateBlobCountOne,
    other: EXPLORER_LABELS.syncStateBlobCountOther,
  });
}

export function getExplorerSyncPendingUpdateCountLabel(value: number): string {
  return formatExplorerCountLabel(value, {
    one: EXPLORER_LABELS.syncStatePendingUpdateCountOne,
    other: EXPLORER_LABELS.syncStatePendingUpdateCountOther,
  });
}

export function getExplorerSyncPendingBlobCountLabel(
  value: number,
  byteLength: number,
): string {
  const label = formatExplorerCountLabel(value, {
    one: EXPLORER_LABELS.syncStatePendingBlobCountOne,
    other: EXPLORER_LABELS.syncStatePendingBlobCountOther,
  });

  return byteLength > 0 ? `${label} (${formatByteLength(byteLength)})` : label;
}

export function getExplorerSyncLaneCountLabel(input: {
  errorCount: number;
  requestCount: number;
  runCount: number;
}): string {
  return [
    formatExplorerCountLabel(input.requestCount, {
      one: EXPLORER_LABELS.syncLanesRequestCountOne,
      other: EXPLORER_LABELS.syncLanesRequestCountOther,
    }),
    formatExplorerCountLabel(input.runCount, {
      one: EXPLORER_LABELS.syncLanesRunCountOne,
      other: EXPLORER_LABELS.syncLanesRunCountOther,
    }),
    formatExplorerCountLabel(input.errorCount, {
      one: EXPLORER_LABELS.syncLanesErrorCountOne,
      other: EXPLORER_LABELS.syncLanesErrorCountOther,
    }),
  ].join(", ");
}

export function getExplorerSyncLaneUploadProgressLabel(progress: {
  bytesTotal: number;
  bytesUploaded: number;
  partsCompleted: number;
  partsTotal: number;
}): string {
  const parts = `${EXPLORER_COUNT_FORMATTER.format(
    progress.partsCompleted,
  )}/${EXPLORER_COUNT_FORMATTER.format(progress.partsTotal)} ${getExplorerPluralLabel(
    progress.partsTotal,
    {
      one: EXPLORER_LABELS.syncLanesUploadPartOne,
      other: EXPLORER_LABELS.syncLanesUploadPartOther,
    },
  )}`;
  const bytes = `${formatByteLength(progress.bytesUploaded)} / ${formatByteLength(
    progress.bytesTotal,
  )}`;

  return `${parts} · ${bytes}`;
}

export function getExplorerBlobBrowserDocumentCountLabel(
  value: number,
): string {
  return formatExplorerCountLabel(value, {
    one: EXPLORER_LABELS.blobBrowserDocumentCountOne,
    other: EXPLORER_LABELS.blobBrowserDocumentCountOther,
  });
}

export function getExplorerBlobBrowserReferenceCountLabel(
  value: number,
): string {
  return formatExplorerCountLabel(value, {
    one: EXPLORER_LABELS.blobBrowserReferenceCountOne,
    other: EXPLORER_LABELS.blobBrowserReferenceCountOther,
  });
}

export function getExplorerContainerInfoManifestHistoryLabel(
  value: number,
): string {
  return formatExplorerCountLabel(value, {
    one: EXPLORER_LABELS.containerInfoEntryCountOne,
    other: EXPLORER_LABELS.containerInfoEntryCountOther,
  });
}

export function getExplorerContainerInfoPathSummaryLabel(input: {
  pathLength: number;
  referencedPrincipalCount: number;
}): string {
  return `${formatExplorerCountLabel(input.pathLength, {
    one: EXPLORER_LABELS.containerInfoEntryCountOne,
    other: EXPLORER_LABELS.containerInfoEntryCountOther,
  })}, ${formatExplorerCountLabel(input.referencedPrincipalCount, {
    one: EXPLORER_LABELS.containerInfoReferencedPrincipalCountOne,
    other: EXPLORER_LABELS.containerInfoReferencedPrincipalCountOther,
  })}`;
}

export function getExplorerContainerInfoEventLabel(eventHash: string): string {
  return `${EXPLORER_LABELS.containerInfoEventPrefix} ${eventHash}`;
}

export function getExplorerContainerInfoRecipientSummaryLabel(input: {
  recipientTargetCount: number;
  wrapCount: number;
}): string {
  return `${formatExplorerCountLabel(input.recipientTargetCount, {
    one: EXPLORER_LABELS.containerInfoRecipientTargetCountOne,
    other: EXPLORER_LABELS.containerInfoRecipientTargetCountOther,
  })}, ${formatExplorerCountLabel(input.wrapCount, {
    one: EXPLORER_LABELS.containerInfoWrapCountOne,
    other: EXPLORER_LABELS.containerInfoWrapCountOther,
  })}`;
}

export function getExplorerContainerInfoGrantSummaryLabel(input: {
  directGrantCount: number;
  referencedPrincipalCount: number;
}): string {
  return `${formatExplorerCountLabel(input.directGrantCount, {
    one: EXPLORER_LABELS.containerInfoGrantCountOne,
    other: EXPLORER_LABELS.containerInfoGrantCountOther,
  })}, ${formatExplorerCountLabel(input.referencedPrincipalCount, {
    one: EXPLORER_LABELS.containerInfoPrincipalCountOne,
    other: EXPLORER_LABELS.containerInfoPrincipalCountOther,
  })}`;
}

function getExplorerBooleanLabel(value: boolean): string {
  return value
    ? EXPLORER_LABELS.documentInfoBooleanYes
    : EXPLORER_LABELS.documentInfoBooleanNo;
}

export function getExplorerDocumentInfoBundleStateLabel(input: {
  hasContentKeyBundle: boolean;
  hasDocumentKekTargets: boolean;
  hasDocumentManifestBundle: boolean;
}): string {
  return [
    `${EXPLORER_LABELS.documentInfoBundleManifest} ${getExplorerBooleanLabel(input.hasDocumentManifestBundle)}`,
    `${EXPLORER_LABELS.documentInfoBundleContentKey} ${getExplorerBooleanLabel(input.hasContentKeyBundle)}`,
    `${EXPLORER_LABELS.documentInfoBundleDocumentKek} ${getExplorerBooleanLabel(input.hasDocumentKekTargets)}`,
  ].join(", ");
}

export function getExplorerDocumentInfoPendingChangesLabel(input: {
  pendingAttachmentByteLength: number;
  pendingAttachmentCount: number;
  pendingUpdateCount: number;
}): string {
  return [
    formatExplorerCountLabel(input.pendingUpdateCount, {
      one: EXPLORER_LABELS.documentInfoUpdateCountOne,
      other: EXPLORER_LABELS.documentInfoUpdateCountOther,
    }),
    `${formatExplorerCountLabel(input.pendingAttachmentCount, {
      one: EXPLORER_LABELS.documentInfoAttachmentCountOne,
      other: EXPLORER_LABELS.documentInfoAttachmentCountOther,
    })} (${formatByteLength(input.pendingAttachmentByteLength)})`,
  ].join(", ");
}

export function getExplorerDocumentInfoManifestHistoryLabel(input: {
  documentContainerManifestHistoryCount: number;
  documentManifestHistoryCount: number;
}): string {
  return [
    formatExplorerCountLabel(input.documentManifestHistoryCount, {
      one: EXPLORER_LABELS.documentInfoDocumentManifestCountOne,
      other: EXPLORER_LABELS.documentInfoDocumentManifestCountOther,
    }),
    formatExplorerCountLabel(input.documentContainerManifestHistoryCount, {
      one: EXPLORER_LABELS.documentInfoContainerManifestCountOne,
      other: EXPLORER_LABELS.documentInfoContainerManifestCountOther,
    }),
  ].join(", ");
}

export function getExplorerDocumentInfoLinkedContainersLabel(input: {
  linkedContainerKeyEpochCount: number;
  linkedContainerManifestCount: number;
}): string {
  return [
    formatExplorerCountLabel(input.linkedContainerManifestCount, {
      one: EXPLORER_LABELS.documentInfoLinkedManifestCountOne,
      other: EXPLORER_LABELS.documentInfoLinkedManifestCountOther,
    }),
    formatExplorerCountLabel(input.linkedContainerKeyEpochCount, {
      one: EXPLORER_LABELS.documentInfoKeyEpochCountOne,
      other: EXPLORER_LABELS.documentInfoKeyEpochCountOther,
    }),
  ].join(", ");
}

export function getExplorerDocumentInfoTargetCountsLabel(input: {
  contentKeyTargetCount: number;
  documentKekTargetCount: number;
}): string {
  return [
    formatExplorerCountLabel(input.contentKeyTargetCount, {
      one: EXPLORER_LABELS.documentInfoContentTargetCountOne,
      other: EXPLORER_LABELS.documentInfoContentTargetCountOther,
    }),
    formatExplorerCountLabel(input.documentKekTargetCount, {
      one: EXPLORER_LABELS.documentInfoDocumentKekTargetCountOne,
      other: EXPLORER_LABELS.documentInfoDocumentKekTargetCountOther,
    }),
  ].join(", ");
}

export function getExplorerDocumentInfoPathLengthLabel(value: number): string {
  return formatExplorerCountLabel(value, {
    one: EXPLORER_LABELS.documentInfoPathEntryCountOne,
    other: EXPLORER_LABELS.documentInfoPathEntryCountOther,
  });
}

export function getExplorerDocumentInfoEpochLabel(value: number): string {
  return `${EXPLORER_LABELS.documentInfoEpochPrefix} ${EXPLORER_COUNT_FORMATTER.format(value)}`;
}

export function getExplorerDocumentInfoAttachmentKindLabel(
  kind: "local" | "local-remote" | "pending" | "remote",
): string {
  switch (kind) {
    case "local":
      return EXPLORER_LABELS.documentInfoAttachmentStateLocal;
    case "local-remote":
      return EXPLORER_LABELS.documentInfoAttachmentStateLocalRemote;
    case "pending":
      return EXPLORER_LABELS.documentInfoAttachmentStatePending;
    case "remote":
      return EXPLORER_LABELS.documentInfoAttachmentStateRemote;
  }
}

export function getExplorerActivateLinkedContainerError(
  containerName: string,
): string {
  return `Failed to make ${containerName} active.`;
}

export function getExplorerDetachLinkedContainerError(
  containerName: string,
): string {
  return `Failed to detach ${containerName}.`;
}

export function getExplorerDetachLinkedContainerLabel(
  containerName: string,
): string {
  return `Detach linked container ${containerName}`;
}

export function getExplorerDocumentSubtitle(input: {
  containerName: string | null;
  documentTypeLabel: string;
}): string {
  return input.containerName
    ? `${input.documentTypeLabel} in ${input.containerName}`
    : input.documentTypeLabel;
}

export function getExplorerBlobPickSubtitle(slotLabel: string): string {
  return `${EXPLORER_LABELS.blobPickSubtitlePrefix} ${slotLabel}.`;
}

export function getExplorerItemTableLabel(containerName: string): string {
  return `Items in ${containerName}`;
}

export function getExplorerContainerInfoInheritedGrantSource(
  containerName: string,
): string {
  return `Inherited from ${containerName}`;
}

export function getExplorerMakeLinkedContainerActiveLabel(
  containerName: string,
): string {
  return `Make linked container ${containerName} active`;
}

export function getExplorerOpenLinkedContainerLabel(
  containerName: string,
): string {
  return `Open linked container ${containerName}`;
}

export function getExplorerFileImportingStatus(input: {
  completedCount: number;
  totalCount: number;
}): string {
  return `Importing ${input.completedCount}/${input.totalCount} files...`;
}

export function getExplorerFileImportCompletedStatus(
  importedCount: number,
): string {
  return `Imported ${importedCount} ${importedCount === 1 ? "file" : "files"}.`;
}

export function getExplorerFileImportPartialStatus(input: {
  importedCount: number;
  totalCount: number;
}): string {
  return `Imported ${input.importedCount} of ${input.totalCount} files.`;
}

export function getExplorerDroppedFileImportFailureLog(
  fileName: string,
): string {
  return `Explorer: failed to import ${fileName}.`;
}

export function getExplorerDroppedFileTooLargeError(input: {
  fileName: string;
  maxByteLength: number;
}): string {
  return `${input.fileName} is larger than ${formatByteLength(
    input.maxByteLength,
  )}.`;
}
