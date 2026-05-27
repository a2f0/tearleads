import { formatByteLength } from "../../utils/formatByteLength";

export const EXPLORER_LABELS = {
  backToContainerAction: "Back to Container",
  containerInfoChooseGroupError: "Choose a group.",
  containerInfoCreatedRow: "Created",
  containerInfoCursorColumn: "Cursor",
  containerInfoEntryCountOne: "entry",
  containerInfoEntryCountOther: "entries",
  containerInfoEventPrefix: "event",
  containerInfoGrantCountOne: "grant",
  containerInfoGrantCountOther: "grants",
  containerInfoGroupField: "Group",
  containerInfoIdRow: "ID",
  containerInfoLaneColumn: "Lane",
  containerInfoLoading: "Loading...",
  containerInfoLocalDetailsHeading: "Local Details",
  containerInfoManifestColumn: "Manifest",
  containerInfoManifestHistoryRow: "Manifest History",
  containerInfoNoGrants: "No grants.",
  containerInfoNoGroupsOption: "No groups",
  containerInfoNoLocalCursor: "No local cursor",
  containerInfoPathColumn: "Path",
  containerInfoPathHeading: "Container Path",
  containerInfoPathRow: "Path",
  containerInfoPermissionColumn: "Permission",
  containerInfoPermissionAdmin: "admin",
  containerInfoPermissionField: "Permission",
  containerInfoPermissionRead: "read",
  containerInfoPermissionWrite: "write",
  containerInfoPrincipalColumn: "Principal",
  containerInfoPrincipalCountOne: "principal",
  containerInfoPrincipalCountOther: "principals",
  containerInfoPrincipalGrantsHeading: "Principal Grants",
  containerInfoRecipientsColumn: "Recipients",
  containerInfoReferencedPrincipalCountOne: "referenced principal",
  containerInfoReferencedPrincipalCountOther: "referenced principals",
  containerInfoRecipientTargetCountOne: "target",
  containerInfoRecipientTargetCountOther: "targets",
  containerInfoSavedColumn: "Saved",
  containerInfoSecurityHeading: "Security",
  containerInfoSecurityKeyEpochRow: "Key Epoch",
  containerInfoSecurityManifestHashRow: "Current Manifest Hash",
  containerInfoSecurityParentKeyEpochRow: "Parent Key Epoch",
  containerInfoShareAction: "Share",
  containerInfoShareGenericFailure: "Failed to share container.",
  containerInfoShareGenericFailureLog: "Failed to share container:",
  containerInfoShareToGroupFailure: "Failed to share container with group.",
  containerInfoShareToGroupHeading: "Share To Group",
  containerInfoShareToPeerAction: "Share With Peer",
  containerInfoShareToPeerFailure: "Failed to share container with peer.",
  containerInfoShareToPeerFailureLog: "Failed to share container with peer:",
  containerInfoShareToPeerHeading: "Share To Peer",
  containerInfoSharingAction: "Sharing...",
  containerInfoSourceColumn: "Source",
  containerInfoSourceDirect: "Direct",
  containerInfoSubjectTypeGroup: "group",
  containerInfoSubjectTypeOrganization: "organization",
  containerInfoSubjectTypeUser: "user",
  containerInfoSyncCursorsHeading: "Sync Cursors",
  containerInfoTitle: "Container Info",
  containerInfoTypeColumn: "Type",
  containerInfoUpdatedRow: "Updated",
  dateCreatedColumn: "Date created",
  dateModifiedColumn: "Date modified",
  documentInfoAttachmentCountOne: "attachment",
  documentInfoAttachmentCountOther: "attachments",
  documentBackToContainerAction: "Back to Container",
  documentInfoAccessEpochRow: "Access Epoch",
  documentInfoAccessStateHashRow: "Access State Hash",
  documentInfoAttachmentBlobColumn: "Blob",
  documentInfoAttachmentKindColumn: "State",
  documentInfoAttachmentNameColumn: "Name",
  documentInfoAttachmentSizeColumn: "Size",
  documentInfoAttachmentSlotColumn: "Slot",
  documentInfoAttachmentTimeColumn: "Time",
  documentInfoAttachmentStateLocal: "local",
  documentInfoAttachmentStatePending: "pending",
  documentInfoAttachmentStateRemote: "remote",
  documentInfoAttachmentsHeading: "Attachments & Blobs",
  documentInfoAuthorizingContainersHeading: "Authorizing Containers",
  documentInfoBackAction: "Back to Document",
  documentInfoBooleanNo: "no",
  documentInfoBooleanYes: "yes",
  documentInfoBundleContentKey: "content key",
  documentInfoBundleDocumentKek: "document KEK",
  documentInfoBundleManifest: "manifest",
  documentInfoBundleStateRow: "Runtime Bundles",
  documentInfoContainerManifestCountOne: "container manifest",
  documentInfoContainerManifestCountOther: "container manifests",
  documentInfoContainerColumn: "Container",
  documentInfoContainerRow: "Container",
  documentInfoContentTargetCountOne: "content target",
  documentInfoContentTargetCountOther: "content targets",
  documentInfoContentKeyEpochRow: "Content Key Epoch",
  documentInfoContentKeyHashRow: "Content Key Target Hash",
  documentInfoCurrentManifestHashRow: "Current Manifest Hash",
  documentInfoDocumentIdRow: "Document ID",
  documentInfoDocumentKekTargetCountOne: "KEK target",
  documentInfoDocumentKekTargetCountOther: "KEK targets",
  documentInfoDocumentKeyHashRow: "Document Key Target Hash",
  documentInfoDocumentManifestCountOne: "document manifest",
  documentInfoDocumentManifestCountOther: "document manifests",
  documentInfoDocumentManifestHistoryRow: "Document Manifest History",
  documentInfoEpochPrefix: "epoch",
  documentInfoGetInfoAction: "Get Info",
  documentInfoIdRow: "Local ID",
  documentInfoKeyEpochCountOne: "key epoch",
  documentInfoKeyEpochCountOther: "key epochs",
  documentInfoLastCommitRow: "Last Commit LSN",
  documentInfoLinkedContainersRow: "Linked Containers",
  documentInfoLinkedManifestCountOne: "manifest",
  documentInfoLinkedManifestCountOther: "manifests",
  documentInfoLoading: "Loading...",
  documentInfoLocalManifestHashRow: "Local Manifest Hash",
  documentInfoLocalDetailsHeading: "Local Details",
  documentInfoNoAttachments: "No attachments or blob bindings.",
  documentInfoNoAuthorizingContainers: "No authorizing containers.",
  documentInfoNoRemoteInfo: "Remote document security info is unavailable.",
  documentInfoPathEntryCountOne: "path entry",
  documentInfoPathEntryCountOther: "path entries",
  documentInfoPendingChangesRow: "Pending Changes",
  documentInfoPreviousManifestHashRow: "Previous Manifest Hash",
  documentInfoRemoteSecurityHeading: "Remote Security",
  documentInfoTargetCountRow: "Target Counts",
  documentInfoTitle: "Document Info",
  documentInfoTypeRow: "Type",
  documentInfoUpdateCountOne: "update",
  documentInfoUpdateCountOther: "updates",
  documentInfoUpdatedRow: "Updated",
  documentLinkAction: "Link",
  documentMoveAction: "Move",
  fileDropHint: "Drop files to import notes.",
  fileImportFailedStatus: "Some files could not be imported.",
  fileImportGenericFailure: "Failed to import files.",
  fileImportStoreNotReady: "Document store was not ready.",
  folderType: "Folder",
  itemNameColumn: "Name",
  itemSyncColumn: "Sync",
  itemTableEmpty: "No items.",
  itemTypeColumn: "Type",
  linkedContainerActiveBadge: "Active",
  linkedContainerActivatingAction: "Activating...",
  linkedContainerDetachAction: "Detach",
  linkedContainerDetachingAction: "Detaching...",
  linkedContainerMakeActiveAction: "Make Active",
  linkedContainersHeading: "Linked Containers",
  newStructuredDocumentAction: "New Structured Document",
  newStructuredDocumentDocumentTypeHeading: "Document Type",
  newStructuredDocumentRouteLabel: "New structured document",
  syncStateError: "Error",
  syncStateBlobCountOne: "blob",
  syncStateBlobCountOther: "blobs",
  syncStateLocal: "Local",
  syncStateOffline: "Offline",
  syncStatePending: "Pending",
  syncStatePendingBlobCountOne: "pending blob",
  syncStatePendingBlobCountOther: "pending blobs",
  syncStatePendingUpdateCountOne: "pending update",
  syncStatePendingUpdateCountOther: "pending updates",
  syncStateSynced: "Synced",
  containerInfoWrapCountOne: "wrap",
  containerInfoWrapCountOther: "wraps",
  unknownDate: "Unknown",
} as const;

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
  kind: "local" | "pending" | "remote",
): string {
  switch (kind) {
    case "local":
      return EXPLORER_LABELS.documentInfoAttachmentStateLocal;
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
  return `Imported ${importedCount} ${importedCount === 1 ? "note" : "notes"}.`;
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
