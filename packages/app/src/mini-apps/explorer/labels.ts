import { formatByteLength } from "../../utils/formatByteLength";

export const EXPLORER_LABELS = {
  dateCreatedColumn: "Date created",
  dateModifiedColumn: "Date modified",
  documentBackToContainerAction: "Back to Container",
  documentLinkAction: "Link",
  documentMoveAction: "Move",
  fileDropHint: "Drop files to import notes.",
  fileImportFailedStatus: "Some files could not be imported.",
  fileImportGenericFailure: "Failed to import files.",
  fileImportStoreNotReady: "Document store was not ready.",
  folderType: "Folder",
  itemNameColumn: "Name",
  itemTableEmpty: "No items.",
  itemTypeColumn: "Type",
  linkedContainerActiveBadge: "Active",
  linkedContainerActivatingAction: "Activating...",
  linkedContainerDetachAction: "Detach",
  linkedContainerDetachingAction: "Detaching...",
  linkedContainerMakeActiveAction: "Make Active",
  linkedContainersHeading: "Linked Containers",
  unknownDate: "Unknown",
} as const;

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
