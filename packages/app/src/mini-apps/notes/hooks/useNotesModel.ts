import { useNoteEditorFields } from "../../../document-types/note/useNoteEditorFields";
import { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../../stores/documents/DocumentsProvider";

export function useNotesModel() {
  const { auth, state } = useTearleadsRuntime();
  const { isAuthenticated } = auth;
  const { online } = state;
  const { requestSync } = useDocument();
  const editorFields = useNoteEditorFields();

  return {
    ...editorFields,
    isAuthenticated,
    online,
    requestSync,
  };
}
