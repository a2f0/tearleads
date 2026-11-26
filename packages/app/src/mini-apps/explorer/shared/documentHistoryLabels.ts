export const EXPLORER_DOCUMENT_HISTORY_LABELS = {
  documentHistoryAction: "History",
  documentHistoryAttachmentsAddedOne: "Added an attachment",
  documentHistoryAttachmentsAddedOther: "Added attachments",
  documentHistoryAttachmentsRemovedOne: "Removed an attachment",
  documentHistoryAttachmentsRemovedOther: "Removed attachments",
  documentHistoryAttachmentsReplacedOne: "Replaced an attachment",
  documentHistoryAttachmentsReplacedOther: "Replaced attachments",
  documentHistoryBackAction: "Back to Document",
  documentHistoryCharacterOne: "character",
  documentHistoryCharacterOther: "characters",
  documentHistoryClockAhead: "Shown as uploaded: a device's clock was ahead.",
  documentHistoryCopyAction: "Save as copy",
  documentHistoryCopyCancel: "Cancel",
  documentHistoryCopyConfirm: "Save copy",
  /** Null while the version's time is not known yet. */
  documentHistoryCopyMessage: (versionTime: string | null) =>
    versionTime === null
      ? "A new document is saved in the same folder with the text, fields, and rows of this version. Attachments are not copied, and this document is not changed."
      : `A new document is saved in the same folder with the text, fields, and rows this one had at ${versionTime}. Attachments are not copied, and this document is not changed.`,
  documentHistoryCopyOpenAction: "Open copy",
  documentHistoryCopyRefused: "This version could not be saved as a copy.",
  documentHistoryCopySaved: "Saved a copy in this folder.",
  documentHistoryCopyTitle: "Save this version as a copy?",
  documentHistoryDocumentUnavailable: "This document is not available.",
  documentHistoryFailed: "History could not be loaded",
  documentHistoryFieldsChanged: "Changed",
  documentHistoryFirstAction: "First version",
  documentHistoryKindChanged: "Changed the document type",
  documentHistoryLastAction: "Latest version",
  documentHistoryLoading: "Loading history...",
  documentHistoryNewerAvailable: "This document has newer edits.",
  documentHistoryNextAction: "Next change",
  documentHistoryNoVisibleChange: "No visible change",
  documentHistoryPauseAction: "Pause",
  documentHistoryPlayAction: "Play",
  documentHistoryPositionLabel: "History position",
  documentHistoryPreviousAction: "Previous change",
  documentHistoryReloadAction: "Load newer edits",
  documentHistoryRestoreAction: "Restore this version",
  documentHistoryRestoreCancel: "Cancel",
  documentHistoryRestoreConfirm: "Restore",
  /** Null while the version's time is not known yet. */
  documentHistoryRestoreMessage: (versionTime: string | null) =>
    `The document's text, fields, and rows go back to how they were ${versionTime === null ? "in this version" : `at ${versionTime}`}. Attachments are not changed. Today's version stays in History, so this can be undone.`,
  documentHistoryRestoreRefused: "This version could not be restored.",
  documentHistoryRestoreTitle: "Restore this version?",
  documentHistoryRowsAddedOne: "Added a row",
  documentHistoryRowsAddedOther: "Added rows",
  documentHistoryRowsChangedOne: "Edited a row",
  documentHistoryRowsChangedOther: "Edited rows",
  documentHistoryRowsRemovedOne: "Removed a row",
  documentHistoryRowsRemovedOther: "Removed rows",
  documentHistorySubtitle: "History",
  documentHistoryTextAdded: "Added",
  documentHistoryTextRemoved: "Removed",
  documentHistoryTextReplaced: "Replaced",
  documentHistoryTextReplacedWith: "with",
  documentHistoryTimeChecking: "Checking when this was uploaded...",
  documentHistoryTimeUnknown: "Time not recorded",
  documentHistoryUploadedBy: "Uploaded by",
  documentHistoryUnavailable:
    "This document has no history on this device yet.",
  documentHistoryVerifyAction: "Verify history",
  documentHistoryVerifyAgainAction: "Check again",
  /** Null before the first page of uploads is read. */
  documentHistoryVerifyChecking: (
    progress: { updatesRead: number; updatesTotal: number } | null,
  ) =>
    progress === null
      ? "Checking the signed uploads..."
      : `Checking ${progress.updatesRead} of ${progress.updatesTotal} uploads...`,
  documentHistoryVerifyFailed: "Couldn't check the history.",
  documentHistoryVerifyMismatch:
    "This device's copy differs from the signed uploads.",
  documentHistoryVerifyProvenance: {
    absent: "This change is not in the server's history.",
    baseline:
      "This change is only in a key-rotation snapshot, as its signer asserted.",
    direct: "This change is in a signed upload.",
    partial: "Only part of this change is in the server's history.",
  },
  documentHistoryVerifyRetryAction: "Try again",
  documentHistoryVerifyServerAhead: "The server also holds newer edits.",
  documentHistoryVerifyShowLocalAction: "Back to this device's copy",
  documentHistoryVerifyShowSignedAction: "View signed history",
  documentHistoryVerifySignedShown:
    "This is the history rebuilt from the signed uploads. This device's copy differs from it.",
  documentHistoryVerifyUnavailable: {
    capture_outdated:
      "This document has newer edits than the history shown. Load them, then check again.",
    epoch_key_unreachable:
      "An older key for this document can't be reached from this device, so older history can't be checked.",
    interrupted: "The check was interrupted.",
    not_synced: "Nothing has been uploaded yet.",
    offline: "Can't check while offline.",
    rejected: "The server's response failed a signature or integrity check.",
    too_large: "This history is too large to check on this device.",
    unsettled:
      "This device couldn't finish reading the history. Try again later.",
  },
  documentHistoryVerifyUnchecked:
    "This is the history stored on this device. It has not been checked.",
  documentHistoryVerifyVerified:
    "Checked against the signed uploads the server holds. This device's copy matches.",
  documentHistoryVerifyVoid: (count: number) =>
    count === 1
      ? "1 upload was set aside as void."
      : `${count} uploads were set aside as void.`,
} as const;
