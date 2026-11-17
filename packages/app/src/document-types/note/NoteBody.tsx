import {
  type ChangeEvent,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import "./NoteDocument.css";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";

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

  useAutoFocusEditorOnReady(ref, ready);

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
// loaded, so this ready false→true edge fires for new notes, opened notes, and
// in-place switches between notes (the shared editor stays mounted while only
// the store swaps). The caret lands at the end of any existing text — a no-op
// for an empty new note — matching the "keep writing" expectation of a notes
// editor. The editor only exists while the note is writable (a read-only note
// renders NoteReadOnlyBody instead), so a note that loads read-only and later
// becomes writable mounts this editor already ready and is focused then; a note
// that never becomes writable has no editor to focus.
function useAutoFocusEditorOnReady(
  ref: RefObject<HTMLTextAreaElement | null>,
  ready: boolean,
) {
  const wasReadyRef = useRef(false);

  useEffect(() => {
    const becameReady = ready && !wasReadyRef.current;
    wasReadyRef.current = ready;

    const editor = ref.current;
    if (!editor || !becameReady) {
      return;
    }

    editor.focus();
    const caret = editor.value.length;
    editor.setSelectionRange(caret, caret);
  }, [ready, ref]);
}

// The editable note body: an autosizing, caret-preserving textarea. Owns its
// editor hook so NoteBody only threads the text/state props through.
function NoteEditorTextarea({
  ready,
  setText,
  syncing,
  text,
}: {
  ready: boolean;
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
  } = useNoteEditorTextarea(text, setText, ready);

  return (
    <textarea
      ref={ref}
      className="note-document-editor"
      value={text}
      onChange={handleChange}
      onSelect={handleSelect}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      placeholder={
        ready
          ? NOTE_DOCUMENT_LABELS.editorReadyPlaceholder
          : NOTE_DOCUMENT_LABELS.editorLoadingPlaceholder
      }
      disabled={!ready}
      aria-label={
        syncing
          ? NOTE_DOCUMENT_LABELS.editorSyncing
          : NOTE_DOCUMENT_LABELS.editor
      }
    />
  );
}

// The body of a note that cannot be edited: one in the Trash, one shared with a
// read-only grant, or a past version. It is plain text, not a read-only
// <textarea>, because a read-only textarea still takes focus and shows a caret
// and so reads as an editor that ignores typing. The text stays selectable for
// copying. It shares the editor's box (`note-document-editor`), so the text sits
// exactly where the editor draws it and nothing shifts when a note changes
// between read-only and writable.
function NoteReadOnlyBody({ ready, text }: { ready: boolean; text: string }) {
  const placeholder = ready
    ? text.length === 0
      ? NOTE_DOCUMENT_LABELS.readOnlyEmpty
      : null
    : NOTE_DOCUMENT_LABELS.editorLoadingPlaceholder;

  return (
    <article
      aria-label={NOTE_DOCUMENT_LABELS.readOnlyBody}
      className="note-document-editor note-document-editor--read-only"
    >
      {placeholder === null ? (
        text
      ) : (
        <span className="note-document-editor-placeholder">{placeholder}</span>
      )}
    </article>
  );
}

// The note's body: the editor while the note is writable, plain text while it
// is not. Shared by the notes mini-app and the explorer's note renderer through
// NoteEditorFields.
export function NoteBody({
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
  return readOnly ? (
    <NoteReadOnlyBody ready={ready} text={text} />
  ) : (
    <NoteEditorTextarea
      ready={ready}
      setText={setText}
      syncing={syncing}
      text={text}
    />
  );
}
