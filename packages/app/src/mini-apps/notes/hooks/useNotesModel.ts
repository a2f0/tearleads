import { useNoteEditorFields } from "../../../document-types/note/useNoteEditorFields";
import { useDocument } from "../../../stores/documents/DocumentsProvider";

// The optional container/local ids wire the note editor's blob picker to the
// active note; the standalone list home omits them and the "Select Blob" control
// stays hidden.
export function useNotesModel(
  params: { containerId?: string | null; localId?: string | undefined } = {},
) {
  const { requestSync } = useDocument();
  const editorFields = useNoteEditorFields(params);

  return {
    ...editorFields,
    requestSync,
  };
}
