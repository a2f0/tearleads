import { useNotes } from "./NotesProvider";
import "./Notes.css";

export function Notes() {
  const { ready, setText, syncing, text } = useNotes();

  return (
    <div className="notes">
      <textarea
        className="notes-editor"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={ready ? "Type your notes here..." : "Loading notes..."}
        disabled={!ready}
        aria-label={syncing ? "Notes editor syncing" : "Notes editor"}
      />
    </div>
  );
}
