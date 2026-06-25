import { useWindowFileMenuItem } from "../../components/window/WindowMenuContext";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { NotesContextMenuLayer } from "./context-menu/NotesContextMenu";
import { useNotesAppModel } from "./hooks/useNotesAppModel";
import { NOTES_LABELS } from "./labels";
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
      <LocalKeyringUnlockGate appName="Notes">
        <NotesApp
          {...(noteId === undefined ? {} : { noteId })}
          {...(containerId === undefined ? {} : { containerId })}
          {...(documentId === undefined ? {} : { documentId })}
        />
      </LocalKeyringUnlockGate>
    );
  }

  NotesWindowComponent.displayName = `NotesWindow(${noteId ?? DEFAULT_DOCUMENT_ID})`;
  return NotesWindowComponent;
}

function NotesApp(props: NotesAppProps) {
  const { setSidebar } = useWindowSidebar();
  const model = useNotesAppModel(props, setSidebar);
  useWindowFileMenuItem({
    disabled: !model.ready,
    id: "notes-new-note",
    label: NOTES_LABELS.newNoteAction,
    onClick: model.createNote,
    priority: 100,
  });

  return (
    <>
      {model.activeSelection ? (
        <DocumentsProvider
          localId={model.activeSelection.noteId}
          {...(model.activeSelection.containerId === undefined
            ? {}
            : { containerId: model.activeSelection.containerId })}
          {...(model.activeSelection.documentId === undefined
            ? {}
            : { documentId: model.activeSelection.documentId })}
        >
          <Notes registerRefreshMenuItem />
        </DocumentsProvider>
      ) : (
        <NotesEmptyState />
      )}
      <NotesContextMenuLayer
        closeContextMenu={model.contextMenu.closeContextMenu}
        contextMenu={model.contextMenu.contextMenu}
        createNote={model.createNote}
        deleteContextMenuNote={model.contextMenu.deleteContextMenuNote}
        ready={model.ready}
      />
    </>
  );
}
