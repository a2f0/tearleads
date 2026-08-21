import type {
  BlobInfoInput,
  BlobInfoList,
  BlobStore,
} from "@symcrypt/client-sdk";
import { useCallback } from "react";
import { MiniAppRoot } from "../../components/mini-app/MiniAppLayout";
import { useWindowFileMenuItem } from "../../components/window/WindowMenuContext";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import {
  useSymCrypt,
  useSymCryptRuntime,
} from "../../providers/sdk/SymCryptProvider";
import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import { LocalKeyringUnlockGate } from "../LocalKeyringUnlockGate";
import { SystemBootstrapGate } from "../SystemBootstrapGate";
import {
  BlobPickProvider,
  useBlobPick,
} from "../shared/blob-pick/BlobPickProvider";
import { BlobPickSurface } from "../shared/blob-pick/blob-list/BlobListScreen";
import { useBlobOrganizationNames } from "../shared/blob-pick/blob-list/useBlobOrganizationNames";
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
  organizationNamesById: ReadonlyMap<string, string>;
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
          organizationNamesById={params.organizationNamesById}
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
  const appData = useSymCryptRuntime();
  const { containerContents, organizations } = useSymCrypt();
  const loadBlobInfo = useCallback(
    (query?: BlobInfoInput | undefined) =>
      containerContents.listBlobInfo(query),
    [containerContents],
  );
  const listLocalOrganizations = useCallback(
    () => organizations.listLocalOrganizations(),
    [organizations],
  );
  const organizationNamesById = useBlobOrganizationNames({
    listLocalOrganizations,
    ready: appData.infra.dbStatus === "ready",
    scope: appData.state.domainScope,
  });
  // A note that lives under Trash (moved here or via the Explorer) is opened
  // read-only rather than editable.
  const activeNoteTrashed = model.isContainerTrashed(
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
            organizationNamesById={organizationNamesById}
          />
        </DocumentsProvider>
      ) : model.showCompactListHome ? (
        <NotesListHome
          createNote={model.createNote}
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
