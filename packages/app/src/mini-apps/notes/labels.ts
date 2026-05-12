export const NOTES_LABELS = {
  attachButton: "Attach File",
  attachmentSyncing: "Syncing attachment.",
  attachmentsEmpty: "No attachments yet.",
  editor: "Notes editor",
  editorLoadingPlaceholder: "Loading notes...",
  editorReadyPlaceholder: "Type your notes here...",
  editorSyncing: "Notes editor syncing",
  emptyStateLoading: "Loading notes...",
  sidebarEmpty: "No notes.",
  sidebarLoading: "Loading...",
  sidebarNewNote: "New Note",
  toolbarDropInstructions: "Drop files into the note to attach them.",
  toolbarLocalSync: "Attachments save locally and sync when you're online.",
  toolbarMissingKeyPackage: "Attachments require a local key package.",
} as const;

export function getNotesToolbarStatusLabel(params: {
  canAttach: boolean;
  isAuthenticated: boolean;
  online: boolean;
}): string {
  const { canAttach, isAuthenticated, online } = params;

  if (!canAttach) {
    return NOTES_LABELS.toolbarMissingKeyPackage;
  }

  return isAuthenticated && online
    ? NOTES_LABELS.toolbarDropInstructions
    : NOTES_LABELS.toolbarLocalSync;
}
