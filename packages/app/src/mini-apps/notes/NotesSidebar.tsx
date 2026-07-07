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
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { useRegisteredWindowSidebar } from "../../components/window/WindowSidebarContext";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
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

interface NotesListProps extends NotesSidebarProps {
  rowHeight?: number | undefined;
  showMetadata?: boolean | undefined;
}

function getNoteTitle(note: DocumentSummary): string {
  return note.title.trim() || getUntitledDocumentTitle(DEFAULT_DOCUMENT_KIND);
}

function getNoteModifiedLabel(note: DocumentSummary): string {
  return `Modified ${formatMiniAppDateTime(note.updatedAt)}`;
}

function isNotesSidebarAreaContextMenuTarget(
  event: MouseEvent<HTMLElement>,
): boolean {
  return (
    !(event.target instanceof Element) || !event.target.closest(".mini-app-row")
  );
}

function NotesList({
  handleNoteContextMenu,
  notes,
  ready,
  rowHeight = MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  selectNote,
  selectedNoteId,
  showMetadata = false,
}: NotesListProps) {
  const virtualNotes = useMiniAppVirtualRows({
    rowHeight,
    rows: notes,
  });

  return (
    <>
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
          rowHeight={rowHeight}
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
                  {showMetadata ? (
                    <MiniAppRowStack>
                      <MiniAppRowText>{getNoteTitle(note)}</MiniAppRowText>
                      <MiniAppRowText muted>
                        {getNoteModifiedLabel(note)}
                      </MiniAppRowText>
                    </MiniAppRowStack>
                  ) : (
                    <MiniAppRowText>{getNoteTitle(note)}</MiniAppRowText>
                  )}
                </MiniAppRowButton>
              </MiniAppVirtualListRow>
            ))}
          </MiniAppVirtualList>
        </MiniAppVirtualListFrame>
      )}
    </>
  );
}

export function NotesListHome(props: NotesSidebarProps) {
  return (
    <section
      aria-label="Notes list"
      className="notes-list-home"
      onContextMenu={(event) => {
        if (
          event.defaultPrevented ||
          !isNotesSidebarAreaContextMenuTarget(event)
        ) {
          return;
        }

        props.handleAreaContextMenu(event);
      }}
    >
      <NotesList
        {...props}
        rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
        showMetadata
      />
    </section>
  );
}

function NotesSidebar(props: NotesSidebarProps) {
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

        props.handleAreaContextMenu(event);
      }}
    >
      <NotesList {...props} />
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
