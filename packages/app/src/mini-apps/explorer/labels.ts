import { formatByteLength } from "../../utils/formatByteLength";

export const EXPLORER_LABELS = {
  dateCreatedColumn: "Date created",
  dateModifiedColumn: "Date modified",
  fileDropHint: "Drop files to import notes.",
  fileImportFailedStatus: "Some files could not be imported.",
  fileImportGenericFailure: "Failed to import files.",
  fileImportStoreNotReady: "Document store was not ready.",
  folderType: "Folder",
  itemNameColumn: "Name",
  itemTableEmpty: "No items.",
  itemTypeColumn: "Type",
  unknownDate: "Unknown",
} as const;

export function getExplorerItemTableLabel(containerName: string): string {
  return `Items in ${containerName}`;
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
