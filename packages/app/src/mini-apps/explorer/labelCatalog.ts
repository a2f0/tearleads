import { EXPLORER_ITEM_LABELS } from "./itemLabelCatalog";

export const EXPLORER_LABELS = {
  columnsMenuButton: "Columns",
  columnsMenuStateOff: "Off",
  columnsMenuStateOn: "On",
  compactSectionsTabsLabel: "Explorer sections",
  containerEmptyTrashAction: "Empty Trash",
  containerMoveToTrashAction: "Move to Trash",
  createChildFolderAction: "Create Child Folder",
  // A create or move that would pass the readable folder depth.
  folderNestedTooDeeply: "This folder would be nested too deeply.",
  // Trash sits under the root, so a very deep subtree cannot move into it.
  trashNestedTooDeeply:
    "This folder is nested too deeply to move to Trash. Use Delete Forever instead.",
  databaseLoadError: "Couldn't open the local database.",
  // Suffixes for the compact sort selector's accessible state.
  columnSortedAscending: "sorted ascending",
  columnSortedDescending: "sorted descending",
  dateCreatedColumn: "Date created",
  dateModifiedColumn: "Date modified",
  // Phone-tier header: the narrow column can only fit one word on a line.
  dateModifiedColumnCompact: "Modified",
  documentDeleteAction: "Move to Trash",
  documentDownloadAction: "Download",
  documentLinkAction: "Link",
  documentMoveAction: "Move",
  documentPurgeAction: "Delete Forever",
  emptyTrashConfirmBody:
    "This permanently deletes everything in the Trash, including all trashed folders and their contents. This cannot be undone.",
  emptyTrashProgressTitle: "Emptying Trash",
  ...EXPLORER_ITEM_LABELS,
  infoContainerGoToAction: "Go to container",
  itemTypeColumn: "Type",
  newContactAction: "New Contact",
  newStructuredDocumentAction: "New Document",
  newStructuredDocumentDocumentTypeHeading: "Document Type",
  newStructuredDocumentNoMatches: "No document types match your search.",
  newStructuredDocumentRouteLabel: "New document",
  newStructuredDocumentSearchLabel: "Search document types",
  purgeProgressCancelledStatus: "Stopped. Some items were permanently deleted.",
  purgeProgressCancelledUntouchedStatus: "Stopped. Nothing was deleted.",
  purgeProgressCloseAction: "Close",
  purgeProgressDoneStatus: "Done.",
  // Delete Forever soon after Move to Trash waits for the move to sync first.
  purgeProgressFinishingMoveStatus: "Finishing move to Trash…",
  purgeProgressMoveUnsettledError:
    "Couldn't finish moving to Trash, so nothing was deleted. Try again in a moment.",
  purgeProgressOfflineError: "You must be online to permanently delete.",
  purgeProgressPartialFailure: "Some items could not be permanently deleted.",
  purgeProgressPreparingStatus: "Preparing…",
  purgeProgressStopAction: "Stop",
  retry: "Retry",
  sharedWithMeSection: "Shared with me",
  unknownDate: "Unknown",
} as const;
