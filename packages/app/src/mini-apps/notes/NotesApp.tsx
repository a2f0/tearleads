import type {
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { MiniAppRoot } from "../../components/shared/MiniAppLayout";
import { useWindowFileMenuItem } from "../../components/window/WindowMenuContext";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import { useContainerTrashLookup } from "../../stores/explorer/useContainerTrashLookup";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { SystemBootstrapGate } from "../SystemBootstrapGate";
import {
  BlobPickProvider,
  useBlobPick,
} from "../shared/blob-pick/BlobPickProvider";
import { BlobPickSurface } from "../shared/blob-pick/blob-list/BlobListScreen";
import { NotesContextMenuLayer } from "./context-menu/NotesContextMenu";
import { useNotesAppModel } from "./hooks/useNotesAppModel";
import { NOTES_LABELS } from "./labels";
import { Notes } from "./Notes";
import { NotesEmptyState } from "./NotesEmptyState";
import { useNotesRoutedChromeActions } from "./NotesRoutedChrome";
import { NotesListHome } from "./NotesSidebar";
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
  return (
    <SystemBootstrapGate message="Bootstrapping workspace...">
      <NotesAppContent {...props} />
    </SystemBootstrapGate>
  );
}

// Inside a note's DocumentsProvider and the blob-pick provider: swaps the editor
// out for the blob picker while a pick is in flight. Swapping (rather than
// overlaying) unmounts the editor, so it re-mounts on return and applies the
// picked blob via its consume-on-mount effect — mirroring how the Explorer's
// route swap drives the same flow.
function NotesEditorOrBlobPicker(params: {
  blobStore: BlobStore;
  containerId: string | null;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  localId: string;
  online: boolean;
}) {
  const { cancelBlobPick, pickTarget, resolveBlobPick } = useBlobPick();

  // Scope the picker to the note that opened it: the blob-pick provider outlives
  // note switches, so a pick left in flight while the user selects another note
  // must not surface its picker on (or resolve into) the newly active note.
  if (pickTarget && pickTarget.localId === params.localId) {
    return (
      <MiniAppRoot padding="none">
        <BlobPickSurface
          blobStore={params.blobStore}
          loadBlobInfo={params.loadBlobInfo}
          onCancel={cancelBlobPick}
          online={params.online}
          onPickBlob={resolveBlobPick}
          slotLabel={pickTarget.slotLabel}
        />
      </MiniAppRoot>
    );
  }

  return (
    <Notes
      containerId={params.containerId}
      localId={params.localId}
      registerRefreshMenuItem
    />
  );
}

function NotesAppContent(props: NotesAppProps) {
  const { setSidebar } = useWindowSidebar();
  const model = useNotesAppModel(props, setSidebar);
  const appData = useTearleadsRuntime();
  const { containerContents } = useTearleads();
  const loadBlobInfo = useCallback(
    (query?: BlobInfoInput | undefined) =>
      containerContents.listBlobInfo(query),
    [containerContents],
  );
  // Notes are listed app-wide by kind, so a note trashed via the Explorer still
  // appears here — render it read-only rather than letting it be edited.
  const { isContainerTrashed } = useContainerTrashLookup();
  const activeNoteTrashed = isContainerTrashed(
    model.activeSelection?.containerId,
  );
  useWindowFileMenuItem({
    disabled: !model.ready,
    id: "notes-new-note",
    label: NOTES_LABELS.newNoteAction,
    onClick: model.createNote,
    priority: 100,
  });
  useNotesRoutedChromeActions({
    createNote: model.createNote,
    ready: model.ready,
  });

  return (
    <BlobPickProvider loadBlobInfo={loadBlobInfo}>
      {model.activeSelection ? (
        <DocumentsProvider
          localId={model.activeSelection.noteId}
          readOnly={activeNoteTrashed}
          {...(model.activeSelection.containerId === undefined
            ? {}
            : { containerId: model.activeSelection.containerId })}
          {...(model.activeSelection.documentId === undefined
            ? {}
            : { documentId: model.activeSelection.documentId })}
        >
          <NotesEditorOrBlobPicker
            blobStore={appData.infra.blobStore}
            containerId={model.activeSelection.containerId ?? null}
            loadBlobInfo={loadBlobInfo}
            localId={model.activeSelection.noteId}
            online={appData.state.online}
          />
        </DocumentsProvider>
      ) : model.showCompactListHome ? (
        <NotesListHome
          handleAreaContextMenu={model.contextMenu.handleAreaContextMenu}
          handleNoteContextMenu={model.contextMenu.handleNoteContextMenu}
          notes={model.notes}
          ready={model.ready}
          selectNote={model.selectNote}
          selectedNoteId={model.selectedNoteId}
        />
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
    </BlobPickProvider>
  );
}
