export const EXPLORER_LABELS = {
  dateCreatedColumn: "Date created",
  dateModifiedColumn: "Date modified",
  folderType: "Folder",
  itemNameColumn: "Name",
  itemTableEmpty: "No items.",
  itemTypeColumn: "Type",
  unknownDate: "Unknown",
} as const;

export function getExplorerItemTableLabel(containerName: string): string {
  return `Items in ${containerName}`;
}
