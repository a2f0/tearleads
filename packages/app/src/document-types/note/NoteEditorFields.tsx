import type { DocumentAttachment } from "@symcrypt/client-sdk";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
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
import "./NoteDocument.css";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";
import { RemoveAttachmentConfirmationDialog } from "./RemoveAttachmentConfirmationDialog";

type NoteHandleSelectedFiles = (fileList: FileList | null) => void;

interface CaretSelection {
  start: number;
  end: number;
}

// Map a caret offset from `oldValue` coordinates into `newValue` coordinates by
// diffing the common prefix and suffix. A single-region edit (the overwhelmingly
// common case for a CRDT merge) maps exactly: a caret before the change stays
// put, a caret after it shifts by the length delta, and a caret inside the
// replaced span clamps to the end of the unchanged prefix. Never worse than the
// browser's default (snap-to-end).
function remapCaret(oldValue: string, newValue: string, caret: number): number {
  const maxPrefix = Math.min(oldValue.length, newValue.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldValue[prefix] === newValue[prefix]) {
    prefix += 1;
  }
  if (caret <= prefix) {
    return caret;
  }

  let suffix = 0;
  const maxSuffix = Math.min(
    oldValue.length - prefix,
    newValue.length - prefix,
  );
  while (
    suffix < maxSuffix &&
    oldValue[oldValue.length - 1 - suffix] ===
      newValue[newValue.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (caret >= oldValue.length - suffix) {
    return caret + (newValue.length - oldValue.length);
  }

  return Math.min(prefix, newValue.length);
}

// Drives the note textarea: keeps it autosized AND preserves the caret when the
// `text` value changes from a NON-local source (a remote CRDT merge or a sync
// republish). A controlled <textarea> whose value is rewritten by React snaps
// the caret to the end; for the user's own keystrokes that is invisible (the
// optimistic value already matches the DOM), but an external change mid-edit
// would otherwise jump the caret and scramble subsequent input. We distinguish
// the two by flagging local edits and only remapping the caret for external
// ones, skipping entirely during IME composition.
function useNoteEditorTextarea(
  text: string,
  setText: (value: string) => void,
  ready: boolean,
  readOnly: boolean,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastValueRef = useRef(text);
  const selectionRef = useRef<CaretSelection>({
    start: text.length,
    end: text.length,
  });
  const localEditRef = useRef(false);
  const composingRef = useRef(false);

  const captureSelection = useCallback((target: HTMLTextAreaElement) => {
    selectionRef.current = {
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length,
    };
  }, []);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      captureSelection(event.currentTarget);
      localEditRef.current = true;
      setText(event.currentTarget.value);
    },
    [captureSelection, setText],
  );

  const handleSelect = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) {
        return;
      }
      captureSelection(event.currentTarget);
    },
    [captureSelection],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      composingRef.current = false;
      captureSelection(event.currentTarget);
    },
    [captureSelection],
  );

  useLayoutEffect(() => {
    const editor = ref.current;
    if (!editor) {
      return;
    }

    if (
      !localEditRef.current &&
      !composingRef.current &&
      text !== lastValueRef.current &&
      document.activeElement === editor
    ) {
      const start = remapCaret(
        lastValueRef.current,
        text,
        selectionRef.current.start,
      );
      const end = remapCaret(
        lastValueRef.current,
        text,
        selectionRef.current.end,
      );
      editor.setSelectionRange(start, end);
      selectionRef.current = { start, end };
    }

    localEditRef.current = false;
    lastValueRef.current = text;

    editor.style.height = "auto";
    editor.style.height = `${editor.scrollHeight}px`;
  }, [text]);

  useAutoFocusEditorOnReady(ref, ready, readOnly);

  return {
    ref,
    handleChange,
    handleSelect,
    handleCompositionStart,
    handleCompositionEnd,
  };
}

// Move focus into the editor body the moment a note becomes editable — whether
// it was just created, loaded from storage, or had write access resolve in — so
// the user can start typing without first clicking it. Each note is backed by a
// fresh documents-store snapshot that starts not-ready and flips to ready once
// loaded, so this focusable false→true edge fires for new notes, opened notes,
// and in-place switches between notes (the shared editor stays mounted while
// only the store swaps). The caret lands at the end of any existing text — a
// no-op for an empty new note — matching the "keep writing" expectation of a
// notes editor. We track the combined focusable state rather than `ready` alone
// so a note that loads read-only and later becomes writable still gets focused;
// a note that never becomes writable is left untouched.
function useAutoFocusEditorOnReady(
  ref: RefObject<HTMLTextAreaElement | null>,
  ready: boolean,
  readOnly: boolean,
) {
  const wasFocusableRef = useRef(false);

  useEffect(() => {
    const focusable = ready && !readOnly;
    const becameFocusable = focusable && !wasFocusableRef.current;
    wasFocusableRef.current = focusable;

    const editor = ref.current;
    if (!editor || !becameFocusable) {
      return;
    }

    editor.focus();
    const caret = editor.value.length;
    editor.setSelectionRange(caret, caret);
  }, [ready, readOnly, ref]);
}

// The note body itself: an autosizing, caret-preserving textarea. Owns its
// editor hook so the parent only threads the text/state props through, keeping
// NoteEditorFields focused on composing the body with the attachments panel.
function NoteEditorTextarea({
  ready,
  readOnly,
  setText,
  syncing,
  text,
}: {
  ready: boolean;
  readOnly: boolean;
  setText: (text: string) => void;
  syncing: boolean;
  text: string;
}) {
  const {
    ref,
    handleChange,
    handleSelect,
    handleCompositionStart,
    handleCompositionEnd,
  } = useNoteEditorTextarea(text, setText, ready, readOnly);

  return (
    <textarea
      ref={ref}
      className="note-document-editor"
      value={text}
      onChange={readOnly ? undefined : handleChange}
      onSelect={handleSelect}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      placeholder={
        ready
          ? NOTE_DOCUMENT_LABELS.editorReadyPlaceholder
          : NOTE_DOCUMENT_LABELS.editorLoadingPlaceholder
      }
      disabled={!ready}
      readOnly={readOnly}
      aria-label={
        readOnly
          ? NOTE_DOCUMENT_LABELS.editorReadOnly
          : syncing
            ? NOTE_DOCUMENT_LABELS.editorSyncing
            : NOTE_DOCUMENT_LABELS.editor
      }
    />
  );
}

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
        <NoteEditorTextarea
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
