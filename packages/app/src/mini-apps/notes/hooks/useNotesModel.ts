import { useNoteEditorFields } from "../../../document-types/note/useNoteEditorFields";
import { useDocument } from "../../../stores/documents/DocumentsProvider";

export function useNotesModel() {
  const { requestSync } = useDocument();
  const editorFields = useNoteEditorFields();

  return {
    ...editorFields,
    requestSync,
  };
}
