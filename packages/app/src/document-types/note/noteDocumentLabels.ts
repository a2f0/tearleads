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
  // Held bytes are a validly signed attachment whose digest differs from the
  // one the document records; its content update has not arrived.
  attachmentDiffers: "Differs",
  // The held file is missing or damaged on this device; the tile's download
  // action fetches it from the server again.
  attachmentUnavailable: "Unavailable",
  // Attach controls in the panel header. "Upload" opens the file picker;
  // "Attach Existing" opens the host's picker of stored files (hidden when
  // there are none).
  uploadAttachment: "Upload",
  selectBlob: "Attach Existing",
  editor: "Notes editor",
  editorLoadingPlaceholder: "Loading notes...",
  editorReadyPlaceholder: "Type your notes here...",
  editorSyncing: "Notes editor syncing",
  // A note that cannot be edited (in the Trash, shared read-only, or a past
  // version) shows its body as plain text instead of the editor.
  readOnlyBody: "Note (read only)",
  readOnlyEmpty: "This note is empty.",
  downloadAttachment: (name: string) => `Download ${name}`,
  retryAttachmentDownload: (name: string) => `Retry download of ${name}`,
  openAttachment: (name: string) => `Open ${name}`,
  removeAttachment: (name: string) => `Remove attachment ${name}`,
  // Remove-attachment confirmation dialog copy.
  removeAttachmentConfirmTitle: "Remove attachment",
  // The attachment's name renders highlighted between the lead and the tail.
  removeAttachmentConfirmMessageLead: "Remove",
  removeAttachmentConfirmMessageTail: "? This can’t be undone.",
  removeAttachmentConfirmCancel: "Cancel",
  removeAttachmentConfirmConfirm: "Remove",
  // Attachment preview overlay copy.
  previewLabel: (name: string) => `Preview of ${name}`,
  previewClose: "Close preview",
  previewNoPreview: "No preview available for this file type.",
  previewLoading: "Loading preview...",
} as const;
