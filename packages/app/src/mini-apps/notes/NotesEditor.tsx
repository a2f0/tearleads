import { NOTES_LABELS } from "./labels";

interface NotesEditorProps {
  ready: boolean;
  setText: (text: string) => void;
  syncing: boolean;
  text: string;
}

export function NotesEditor({
  ready,
  setText,
  syncing,
  text,
}: NotesEditorProps) {
  return (
    <textarea
      className="notes-editor"
      value={text}
      onChange={(event) => setText(event.target.value)}
      placeholder={
        ready
          ? NOTES_LABELS.editorReadyPlaceholder
          : NOTES_LABELS.editorLoadingPlaceholder
      }
      disabled={!ready}
      aria-label={syncing ? NOTES_LABELS.editorSyncing : NOTES_LABELS.editor}
    />
  );
}
