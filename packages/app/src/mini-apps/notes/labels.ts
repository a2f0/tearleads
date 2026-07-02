export const NOTES_LABELS = {
  attachButton: "Attach File",
  deleteNoteAction: "Move to Trash",
  emptyStateLoading: "Loading notes...",
  newNoteAction: "New Note",
  sidebarEmpty: "No notes.",
  sidebarLoading: "Loading...",
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
