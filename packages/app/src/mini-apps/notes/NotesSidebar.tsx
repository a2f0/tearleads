import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
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
  notes: ReadonlyArray<DocumentSummary>;
  ready: boolean;
  selectNote: (noteId: string) => void;
  selectedNoteId: string | null;
}

function getNoteTitle(note: DocumentSummary): string {
  return note.title.trim() || getUntitledDocumentTitle(DEFAULT_DOCUMENT_KIND);
}

function NotesSidebar({
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
    <MiniAppSidebar className="mini-app-sidebar--virtual">
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
  const { notes, ready, selectNote, selectedNoteId, setSidebar } = params;
  const sidebar = useMemo(
    () => (
      <NotesSidebar
        notes={notes}
        ready={ready}
        selectNote={selectNote}
        selectedNoteId={selectedNoteId}
      />
    ),
    [notes, ready, selectNote, selectedNoteId],
  );

  useRegisteredWindowSidebar({ setSidebar, sidebar });
}
