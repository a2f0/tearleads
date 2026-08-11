import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@tearleads/client-sdk";
import type { MouseEvent } from "react";
import {
  MiniAppSidebar,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import {
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../components/shared/classNames";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import {
  createAreaContextMenuHandler,
  type MiniAppListPresentation,
  MiniAppRowActionsKebab,
  useMiniAppSidebarPanel,
} from "../shared/list-panel/MiniAppListPanel";
import { NOTES_LABELS } from "./labels";
import { NotesEmptyTile } from "./NotesEmptyTile";
import type { NotesSetSidebar } from "./types";

const NOTES_ROW_SELECTOR = ".mini-app-row";

interface NotesSidebarProps {
  createNote: () => void;
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

interface NotesListProps extends NotesSidebarProps, MiniAppListPresentation {
  // Give the empty-state tile its full sentence. Only the wide list home has
  // room; the sidebar rail (160px by default) truncates it mid-word.
  showFullLabel?: boolean | undefined;
}

function getNoteTitle(note: DocumentSummary): string {
  return note.title.trim() || getUntitledDocumentTitle(DEFAULT_DOCUMENT_KIND);
}

function getNoteModifiedLabel(note: DocumentSummary): string {
  return `${NOTES_LABELS.modifiedPrefix} ${formatMiniAppDateTime(
    note.updatedAt,
  )}`;
}

function NotesList({
  bleed = false,
  createNote,
  divided = false,
  handleAreaContextMenu,
  handleNoteContextMenu,
  notes,
  ready,
  rowHeight = MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  selectNote,
  selectedNoteId,
  showActions = false,
  showFullLabel = false,
  showMetadata = false,
}: NotesListProps) {
  const virtualNotes = useMiniAppVirtualRows({
    rowHeight,
    rows: notes,
  });

  return (
    <>
      {!ready ? (
        <MiniAppStatus className="notes-sidebar-status">
          {NOTES_LABELS.sidebarLoading}
        </MiniAppStatus>
      ) : notes.length === 0 ? (
        // Deliberately not bled like the populated list below: a dashed tile
        // reads as a placed object, so it keeps the surface's own inset rather
        // than running edge-to-edge.
        <NotesEmptyTile
          createNote={createNote}
          onContextMenu={handleAreaContextMenu}
          rowHeight={rowHeight}
          showFullLabel={showFullLabel}
        />
      ) : (
        <MiniAppVirtualListFrame
          className={classNames(
            bleed && "mini-app-virtual-list-frame--bleed",
            // The list home fills its route, so it also bleeds its bottom edge
            // to sit flush against the mobile task bar.
            bleed && "mini-app-virtual-list-frame--bleed-block-end",
          )}
          ref={virtualNotes.frameRef}
          rowHeight={rowHeight}
        >
          <MiniAppVirtualList
            bottomPadding={virtualNotes.bottomPadding}
            className={divided ? "mini-app-virtual-list--divided" : undefined}
            topPadding={virtualNotes.topPadding}
          >
            {virtualNotes.rows.map((note) => {
              const title = getNoteTitle(note);
              return (
                <MiniAppVirtualListRow
                  className={classNames(
                    showActions && "mini-app-virtual-list-row--actions",
                  )}
                  key={note.id}
                >
                  <MiniAppRowButton
                    onClick={() => selectNote(note.id)}
                    onContextMenu={(event) =>
                      handleNoteContextMenu(event, note.id)
                    }
                    selected={selectedNoteId === note.id}
                  >
                    {showMetadata ? (
                      <MiniAppRowStack>
                        <MiniAppRowText>{title}</MiniAppRowText>
                        <MiniAppRowText muted>
                          {getNoteModifiedLabel(note)}
                        </MiniAppRowText>
                      </MiniAppRowStack>
                    ) : (
                      <MiniAppRowText>{title}</MiniAppRowText>
                    )}
                  </MiniAppRowButton>
                  {showActions ? (
                    <MiniAppRowActionsKebab
                      openContextMenu={(event) =>
                        handleNoteContextMenu(event, note.id)
                      }
                      rowName={title}
                    />
                  ) : null}
                </MiniAppVirtualListRow>
              );
            })}
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
      onContextMenu={createAreaContextMenuHandler(
        NOTES_ROW_SELECTOR,
        props.handleAreaContextMenu,
      )}
    >
      <NotesList
        {...props}
        bleed
        divided
        rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
        showActions
        showFullLabel
        showMetadata
      />
    </section>
  );
}

function NotesSidebar(props: NotesSidebarProps & { showActions: boolean }) {
  return (
    <MiniAppSidebar
      className="mini-app-sidebar--virtual"
      onContextMenu={createAreaContextMenuHandler(
        NOTES_ROW_SELECTOR,
        props.handleAreaContextMenu,
      )}
    >
      <NotesList {...props} />
    </MiniAppSidebar>
  );
}

export function useNotesSidebarPanel(
  params: NotesSidebarProps & { setSidebar: NotesSetSidebar },
) {
  const { setSidebar, ...props } = params;
  useMiniAppSidebarPanel({ Sidebar: NotesSidebar, props, setSidebar });
}
