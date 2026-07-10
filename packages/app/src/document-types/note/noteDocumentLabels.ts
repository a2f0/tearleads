// Shared note presentation labels. Both the notes mini-app and the explorer's
// note document renderer drive their editor/attachments UI off these strings so
// the copy stays consistent across the two surfaces.

export const NOTE_DOCUMENT_LABELS = {
  attachments: "Attachments",
  // Section heading count, e.g. "Attachments · 3". Singular/plural agnostic
  // because the count carries the meaning.
  attachmentsCount: (count: number) => `Attachments · ${count}`,
  attachmentsEmpty: "No attachments yet.",
  attachmentsEmptyHint: "Drag files here or use Add to attach them.",
  attachmentSyncing: "Syncing",
  addAttachment: "Add",
  addAttachmentLabel: "Add attachment",
  editor: "Notes editor",
  editorLoadingPlaceholder: "Loading notes...",
  editorReadyPlaceholder: "Type your notes here...",
  editorReadOnly: "Notes editor read only",
  editorSyncing: "Notes editor syncing",
  downloadAttachment: (name: string) => `Download ${name}`,
  openAttachment: (name: string) => `Open ${name}`,
  removeAttachment: (name: string) => `Remove attachment ${name}`,
  // Attachment preview overlay copy.
  previewLabel: (name: string) => `Preview of ${name}`,
  previewClose: "Close preview",
  previewNoPreview: "No preview available for this file type.",
  previewLoading: "Loading preview...",
} as const;
