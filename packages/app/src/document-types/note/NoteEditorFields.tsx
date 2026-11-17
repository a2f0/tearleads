import type { DocumentAttachment } from "@tearleads/client-sdk";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useState,
} from "react";
import { classNames } from "../../components/shared/classNames";
import { NoteAttachmentOverlay } from "./NoteAttachmentPreview";
import {
  type NoteAttachmentImageUrlBySlotId,
  type NoteAttachmentStatusBySlotId,
  NoteAttachmentsPanel,
  type NoteDropzoneElement,
} from "./NoteAttachmentsPanel";
import { NoteBody } from "./NoteBody";
import "./NoteDocument.css";
import { RemoveAttachmentConfirmationDialog } from "./RemoveAttachmentConfirmationDialog";

type NoteHandleSelectedFiles = (fileList: FileList | null) => void;

// Gates attachment removal behind a confirm dialog: the trash buttons only
// stage a pending slot, and the destructive store edit runs on confirm. The
// pending attachment is derived from the live list so a remote merge that drops
// the file also dismisses the prompt (never confirming a missing attachment).
function useRemoveAttachmentConfirmation(
  attachments: readonly DocumentAttachment[],
  removeAttachment: (slotId: string) => void,
) {
  const [pendingRemovalSlotId, setPendingRemovalSlotId] = useState<
    string | null
  >(null);

  const pendingRemovalAttachment =
    pendingRemovalSlotId === null
      ? null
      : (attachments.find(
          (attachment) => attachment.slotId === pendingRemovalSlotId,
        ) ?? null);

  // Adjust state during render (React's recommended pattern over an effect) so
  // the prompt drops in the same commit its attachment vanishes — no extra
  // paint, no flash of an empty dialog.
  if (pendingRemovalSlotId !== null && pendingRemovalAttachment === null) {
    setPendingRemovalSlotId(null);
  }

  const requestRemoveAttachment = useCallback((slotId: string) => {
    setPendingRemovalSlotId(slotId);
  }, []);

  const cancelRemoveAttachment = useCallback(() => {
    setPendingRemovalSlotId(null);
  }, []);

  const confirmRemoveAttachment = useCallback(() => {
    if (pendingRemovalSlotId !== null) {
      removeAttachment(pendingRemovalSlotId);
    }
    setPendingRemovalSlotId(null);
  }, [removeAttachment, pendingRemovalSlotId]);

  return {
    pendingRemovalAttachment,
    requestRemoveAttachment,
    cancelRemoveAttachment,
    confirmRemoveAttachment,
  };
}

// The shared hidden file input that the panel's Upload button clicks (via
// fileInputRef). Kept multiple/unfiltered so a note can gather several files of
// any type at once. Clearing the value after each change lets re-selecting the
// same file fire onChange again; a read-only note just resets without attaching.
function NoteAttachmentFileInput({
  canAttach,
  fileInputId,
  fileInputRef,
  handleSelectedFiles,
  ready,
  readOnly,
}: {
  canAttach: boolean;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleSelectedFiles: NoteHandleSelectedFiles;
  ready: boolean;
  readOnly: boolean;
}) {
  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (readOnly) {
      event.currentTarget.value = "";
      return;
    }

    handleSelectedFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  return (
    <input
      id={fileInputId}
      ref={fileInputRef}
      className="note-document-file-input"
      type="file"
      multiple
      disabled={!ready || !canAttach || readOnly}
      onChange={handleInputChange}
    />
  );
}

// Shared note editor + attachments presentation used by both the notes
// mini-app and the explorer's note document renderer. It is intentionally
// unaware of how a note is stored: callers pass the editor text plus an
// attachment value map and the drag/drop + file-input handlers, mapping their
// own model into this shape. The hidden file input lives here so the dropzone
// label can trigger it; an optional `toolbar` slot lets a caller render an
// explicit attach control wired to the same `fileInputId`. The note body is the
// primary surface (top); attachments are gathered into a panel beneath it, and
// a tile opens an enlarged preview overlay.
export function NoteEditorFields({
  attachments,
  attachmentStatusBySlotId,
  attachmentStorageKeyBySlotId,
  canAttach,
  dragActive,
  fileInputId,
  fileInputRef,
  handleDownloadAttachment,
  handleDragEnter,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleRemoveAttachment,
  handleSelectBlob,
  handleSelectedFiles,
  imageUrlBySlotId,
  ready,
  readOnly,
  setText,
  syncing,
  text,
  toolbar,
}: {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: NoteAttachmentStatusBySlotId;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  canAttach: boolean;
  dragActive: boolean;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleDownloadAttachment: (slotId: string) => void;
  handleDragEnter: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDragLeave: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDragOver: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDrop: (event: DragEvent<NoteDropzoneElement>) => void;
  handleRemoveAttachment: (slotId: string) => void;
  handleSelectBlob?: (() => void) | undefined;
  handleSelectedFiles: NoteHandleSelectedFiles;
  imageUrlBySlotId: NoteAttachmentImageUrlBySlotId;
  ready: boolean;
  readOnly: boolean;
  setText: (text: string) => void;
  syncing: boolean;
  text: string;
  toolbar?: ReactNode | undefined;
}) {
  const [previewSlotId, setPreviewSlotId] = useState<string | null>(null);
  const interactive = canAttach && !readOnly;
  const dropzoneClassName = classNames(
    "note-document-dropzone",
    dragActive && "note-document-dropzone--active",
    !interactive && "note-document-dropzone--disabled",
  );

  // Match the structured-document slots: the Upload button opens the shared
  // hidden file input by clicking its ref rather than a label-for, so the note
  // and slot upload controls behave identically.
  const handleUploadAttachment = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  const previewAttachment =
    previewSlotId === null
      ? null
      : (attachments.find(
          (attachment) => attachment.slotId === previewSlotId,
        ) ?? null);

  // Close the preview if its attachment disappears (removed here or via a
  // remote merge) so the overlay never lingers over a missing file.
  useEffect(() => {
    if (previewSlotId !== null && previewAttachment === null) {
      setPreviewSlotId(null);
    }
  }, [previewSlotId, previewAttachment]);

  const {
    pendingRemovalAttachment,
    requestRemoveAttachment,
    cancelRemoveAttachment,
    confirmRemoveAttachment,
  } = useRemoveAttachmentConfirmation(attachments, handleRemoveAttachment);

  return (
    <>
      {toolbar}
      <div className="note-document-scroll">
        <NoteBody
          ready={ready}
          readOnly={readOnly}
          setText={setText}
          syncing={syncing}
          text={text}
        />
        <NoteAttachmentsPanel
          attachments={attachments}
          attachmentStatusBySlotId={attachmentStatusBySlotId}
          canAttach={canAttach}
          dropzoneClassName={dropzoneClassName}
          handleDragEnter={handleDragEnter}
          handleDragLeave={handleDragLeave}
          handleDragOver={handleDragOver}
          handleDrop={handleDrop}
          handleDownloadAttachment={handleDownloadAttachment}
          handleRemoveAttachment={requestRemoveAttachment}
          imageUrlBySlotId={imageUrlBySlotId}
          interactive={interactive}
          onOpenAttachment={setPreviewSlotId}
          onSelectBlob={handleSelectBlob}
          onUploadAttachment={handleUploadAttachment}
        />
      </div>
      <NoteAttachmentFileInput
        canAttach={canAttach}
        fileInputId={fileInputId}
        fileInputRef={fileInputRef}
        handleSelectedFiles={handleSelectedFiles}
        ready={ready}
        readOnly={readOnly}
      />
      {previewAttachment ? (
        <NoteAttachmentOverlay
          attachment={previewAttachment}
          canRemove={interactive}
          imageUrl={imageUrlBySlotId[previewAttachment.slotId]}
          storageKey={attachmentStorageKeyBySlotId[previewAttachment.slotId]}
          onClose={() => setPreviewSlotId(null)}
          onDownload={handleDownloadAttachment}
          onRemove={requestRemoveAttachment}
        />
      ) : null}
      {pendingRemovalAttachment ? (
        <RemoveAttachmentConfirmationDialog
          attachment={pendingRemovalAttachment}
          onCancel={cancelRemoveAttachment}
          onConfirm={confirmRemoveAttachment}
        />
      ) : null}
    </>
  );
}
