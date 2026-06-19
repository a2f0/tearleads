// Shared note presentation labels. Both the notes mini-app and the explorer's
// note document renderer drive their editor/attachments UI off these strings so
// the copy stays consistent across the two surfaces.

export const NOTE_DOCUMENT_LABELS = {
  attachmentsEmpty: "No attachments yet.",
  attachmentSyncing: "Syncing attachment.",
  editor: "Notes editor",
  editorLoadingPlaceholder: "Loading notes...",
  editorReadyPlaceholder: "Type your notes here...",
  editorSyncing: "Notes editor syncing",
} as const;
