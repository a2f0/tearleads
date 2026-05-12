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
      placeholder={ready ? "Type your notes here..." : "Loading notes..."}
      disabled={!ready}
      aria-label={syncing ? "Notes editor syncing" : "Notes editor"}
    />
  );
}
