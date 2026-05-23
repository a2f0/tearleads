import { formatByteLength } from "../../utils/formatByteLength";

export const EXPLORER_LABELS = {
  backToContainerAction: "Back to Container",
  containerInfoChooseGroupError: "Choose a group.",
  containerInfoCreatedRow: "Created",
  containerInfoCursorColumn: "Cursor",
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
  containerInfoPrincipalGrantsHeading: "Principal Grants",
  containerInfoRecipientsColumn: "Recipients",
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
  documentBackToContainerAction: "Back to Container",
  documentInfoAccessEpochRow: "Access Epoch",
  documentInfoAccessStateHashRow: "Access State Hash",
  documentInfoAttachmentBlobColumn: "Blob",
  documentInfoAttachmentKindColumn: "State",
  documentInfoAttachmentNameColumn: "Name",
  documentInfoAttachmentSizeColumn: "Size",
  documentInfoAttachmentSlotColumn: "Slot",
  documentInfoAttachmentTimeColumn: "Time",
  documentInfoAttachmentsHeading: "Attachments & Blobs",
  documentInfoAuthorizingContainersHeading: "Authorizing Containers",
  documentInfoBackAction: "Back to Document",
  documentInfoBundleStateRow: "Runtime Bundles",
  documentInfoContainerColumn: "Container",
  documentInfoContainerRow: "Container",
  documentInfoContentKeyEpochRow: "Content Key Epoch",
  documentInfoContentKeyHashRow: "Content Key Target Hash",
  documentInfoCurrentManifestHashRow: "Current Manifest Hash",
  documentInfoDocumentIdRow: "Document ID",
  documentInfoDocumentKeyHashRow: "Document Key Target Hash",
  documentInfoDocumentManifestHistoryRow: "Document Manifest History",
  documentInfoGetInfoAction: "Get Info",
  documentInfoIdRow: "Local ID",
  documentInfoLastCommitRow: "Last Commit LSN",
  documentInfoLinkedContainersRow: "Linked Containers",
  documentInfoLoading: "Loading...",
  documentInfoLocalManifestHashRow: "Local Manifest Hash",
  documentInfoLocalDetailsHeading: "Local Details",
  documentInfoNoAttachments: "No attachments or blob bindings.",
  documentInfoNoAuthorizingContainers: "No authorizing containers.",
  documentInfoNoRemoteInfo: "Remote document security info is unavailable.",
  documentInfoPendingChangesRow: "Pending Changes",
  documentInfoPreviousManifestHashRow: "Previous Manifest Hash",
  documentInfoRemoteSecurityHeading: "Remote Security",
  documentInfoTargetCountRow: "Target Counts",
  documentInfoTitle: "Document Info",
  documentInfoTypeRow: "Type",
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
