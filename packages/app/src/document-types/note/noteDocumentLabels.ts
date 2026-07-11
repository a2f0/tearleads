// Shared note presentation labels. Both the notes mini-app and the explorer's
// note document renderer drive their editor/attachments UI off these strings so
// the copy stays consistent across the two surfaces.

export const NOTE_DOCUMENT_LABELS = {
  attachments: "Attachments",
  // Section heading count, e.g. "Attachments · 3". Singular/plural agnostic
  // because the count carries the meaning.
  attachmentsCount: (count: number) => `Attachments · ${count}`,
  attachmentsEmpty: "No attachments yet.",
  attachmentsEmptyHint: "Drag files here or use Upload to attach them.",
  attachmentSyncing: "Syncing",
  // Attach controls in the panel header. "Upload" opens the file picker;
  // "Select Blob" opens the host's blob picker (hidden when no blobs exist).
  uploadAttachment: "Upload",
  selectBlob: "Select Blob",
  editor: "Notes editor",
  editorLoadingPlaceholder: "Loading notes...",
  editorReadyPlaceholder: "Type your notes here...",
  editorReadOnly: "Notes editor read only",
  editorSyncing: "Notes editor syncing",
  downloadAttachment: (name: string) => `Download ${name}`,
  openAttachment: (name: string) => `Open ${name}`,
  removeAttachment: (name: string) => `Remove attachment ${name}`,
  // Remove-attachment confirmation dialog copy.
  removeAttachmentConfirmTitle: "Remove attachment",
  removeAttachmentConfirmMessage: (name: string) =>
    `Remove “${name}”? This can’t be undone.`,
  removeAttachmentConfirmCancel: "Cancel",
  removeAttachmentConfirmConfirm: "Remove",
  // Attachment preview overlay copy.
  previewLabel: (name: string) => `Preview of ${name}`,
  previewClose: "Close preview",
  previewNoPreview: "No preview available for this file type.",
  previewLoading: "Loading preview...",
} as const;
