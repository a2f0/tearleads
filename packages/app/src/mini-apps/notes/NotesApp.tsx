import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import { useNotesAppModel } from "./hooks/useNotesAppModel";
import { Notes } from "./Notes";
import { NotesEmptyState } from "./NotesEmptyState";
import type { NotesAppProps } from "./types";

export function createNotesWindowComponent({
  noteId,
  containerId,
  documentId,
}: NotesAppProps = {}) {
  function NotesWindowComponent() {
    return (
      <NotesApp
        {...(noteId === undefined ? {} : { noteId })}
        {...(containerId === undefined ? {} : { containerId })}
        {...(documentId === undefined ? {} : { documentId })}
      />
    );
  }

  NotesWindowComponent.displayName = `NotesWindow(${noteId ?? DEFAULT_DOCUMENT_ID})`;
  return NotesWindowComponent;
}

function NotesApp(props: NotesAppProps) {
  const { setSidebar } = useWindowSidebar();
  const model = useNotesAppModel(props, setSidebar);

  if (!model.activeSelection) {
    return <NotesEmptyState />;
  }

  return (
    <DocumentsProvider
      localId={model.activeSelection.noteId}
      {...(model.activeSelection.containerId === undefined
        ? {}
        : { containerId: model.activeSelection.containerId })}
      {...(model.activeSelection.documentId === undefined
        ? {}
        : { documentId: model.activeSelection.documentId })}
    >
      <Notes />
    </DocumentsProvider>
  );
}
