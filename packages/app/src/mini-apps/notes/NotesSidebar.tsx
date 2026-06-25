import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@tearleads/client-sdk";
import { type MouseEvent, useMemo } from "react";
import {
  MiniAppSidebar,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { useRegisteredWindowSidebar } from "../../components/window/WindowSidebarContext";
import { NOTES_LABELS } from "./labels";
import type { NotesSetSidebar } from "./types";

interface NotesSidebarProps {
  handleAreaContextMenu: (event: MouseEvent<HTMLElement>) => void;
  handleNoteContextMenu: (
    event: MouseEvent<HTMLElement>,
    noteId: string,
  ) => void;
  notes: ReadonlyArray<DocumentSummary>;
  ready: boolean;
  selectNote: (noteId: string) => void;
  selectedNoteId: string | null;
}

function getNoteTitle(note: DocumentSummary): string {
  return note.title.trim() || getUntitledDocumentTitle(DEFAULT_DOCUMENT_KIND);
}

function isNotesSidebarAreaContextMenuTarget(
  event: MouseEvent<HTMLElement>,
): boolean {
  return (
    !(event.target instanceof Element) || !event.target.closest(".mini-app-row")
  );
}

function NotesSidebar({
  handleAreaContextMenu,
  handleNoteContextMenu,
  notes,
  ready,
  selectNote,
  selectedNoteId,
}: NotesSidebarProps) {
  const virtualNotes = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
    rows: notes,
  });

  return (
    <MiniAppSidebar
      className="mini-app-sidebar--virtual"
      onContextMenu={(event) => {
        if (
          event.defaultPrevented ||
          !isNotesSidebarAreaContextMenuTarget(event)
        ) {
          return;
        }

        handleAreaContextMenu(event);
      }}
    >
      {!ready ? (
        <MiniAppStatus className="notes-sidebar-empty">
          {NOTES_LABELS.sidebarLoading}
        </MiniAppStatus>
      ) : notes.length === 0 ? (
        <MiniAppStatus className="notes-sidebar-empty">
          {NOTES_LABELS.sidebarEmpty}
        </MiniAppStatus>
      ) : (
        <MiniAppVirtualListFrame
          ref={virtualNotes.frameRef}
          rowHeight={MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT}
        >
          <MiniAppVirtualList
            bottomPadding={virtualNotes.bottomPadding}
            topPadding={virtualNotes.topPadding}
          >
            {virtualNotes.rows.map((note) => (
              <MiniAppVirtualListRow key={note.id}>
                <MiniAppRowButton
                  onClick={() => selectNote(note.id)}
                  onContextMenu={(event) =>
                    handleNoteContextMenu(event, note.id)
                  }
                  selected={selectedNoteId === note.id}
                >
                  <MiniAppRowText>{getNoteTitle(note)}</MiniAppRowText>
                </MiniAppRowButton>
              </MiniAppVirtualListRow>
            ))}
          </MiniAppVirtualList>
        </MiniAppVirtualListFrame>
      )}
    </MiniAppSidebar>
  );
}

export function useNotesSidebarPanel(
  params: NotesSidebarProps & {
    setSidebar: NotesSetSidebar;
  },
) {
  const {
    handleAreaContextMenu,
    handleNoteContextMenu,
    notes,
    ready,
    selectNote,
    selectedNoteId,
    setSidebar,
  } = params;
  const sidebar = useMemo(
    () => (
      <NotesSidebar
        handleAreaContextMenu={handleAreaContextMenu}
        handleNoteContextMenu={handleNoteContextMenu}
        notes={notes}
        ready={ready}
        selectNote={selectNote}
        selectedNoteId={selectedNoteId}
      />
    ),
    [
      handleAreaContextMenu,
      handleNoteContextMenu,
      notes,
      ready,
      selectNote,
      selectedNoteId,
    ],
  );

  useRegisteredWindowSidebar({ setSidebar, sidebar });
}
