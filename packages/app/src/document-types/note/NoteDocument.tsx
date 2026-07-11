import "./NoteDocument.css";
import { NoteEditorFields } from "./NoteEditorFields";
import { useNoteEditorFields } from "./useNoteEditorFields";

// Explorer-facing note renderer: the editor and attachments without the notes
// mini-app's toolbar chrome, since the explorer supplies its own header and
// actions. The shared editor data wiring and presentation are reused from
// useNoteEditorFields / NoteEditorFields so behavior stays identical to the
// standalone notes mini-app. The container/local ids come from the explorer so
// the "Select Blob" control can route to the host blob picker; the standalone
// mini-app renders without them and that control stays hidden.
export function NoteDocument(params: {
  containerId?: string | null;
  localId?: string;
}) {
  const model = useNoteEditorFields({
    containerId: params.containerId ?? null,
    ...(params.localId === undefined ? {} : { localId: params.localId }),
  });

  return (
    <div className="note-document">
      <NoteEditorFields {...model} />
    </div>
  );
}
