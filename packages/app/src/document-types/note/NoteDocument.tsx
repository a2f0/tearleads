import "./NoteDocument.css";
import { NoteEditorFields } from "./NoteEditorFields";
import { useNoteEditorFields } from "./useNoteEditorFields";

// Explorer-facing note renderer: the editor and attachments without the notes
// mini-app's toolbar chrome, since the explorer supplies its own header and
// actions. The shared editor data wiring and presentation are reused from
// useNoteEditorFields / NoteEditorFields so behavior stays identical to the
// standalone notes mini-app.
export function NoteDocument() {
  const model = useNoteEditorFields();

  return (
    <div className="note-document">
      <NoteEditorFields {...model} />
    </div>
  );
}
