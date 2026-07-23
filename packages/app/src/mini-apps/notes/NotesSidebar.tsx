import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@tearleads/client-sdk";
import { type MouseEvent, useMemo } from "react";
import {
  MiniAppSidebar,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import { MiniAppRowActionsButton } from "../../components/mini-app/MiniAppTable";
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
import { useRegisteredWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useRoutedLayoutActive } from "../../navigation/useRoutedLayoutActive";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import { NOTES_LABELS } from "./labels";
import { NotesEmptyTile } from "./NotesEmptyTile";
import type { NotesSetSidebar } from "./types";

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

interface NotesListProps extends NotesSidebarProps {
  // Bleed the list to the screen edges on the mobile list home (the narrow
  // sidebar stays inset).
  bleed?: boolean | undefined;
  // Draw divider lines between entries (the mobile list home; the narrow
  // sidebar leaves them off).
  divided?: boolean | undefined;
  rowHeight?: number | undefined;
  // Render a trailing kebab that opens the row's context menu (the mobile list
  // home; the sidebar relies on right-click / long-press).
  showActions?: boolean | undefined;
  // Give the empty-state tile its full sentence. Only the wide list home has
  // room; the sidebar rail (160px by default) truncates it mid-word.
  showFullLabel?: boolean | undefined;
  showMetadata?: boolean | undefined;
}

function getNoteTitle(note: DocumentSummary): string {
  return note.title.trim() || getUntitledDocumentTitle(DEFAULT_DOCUMENT_KIND);
}

function getNoteModifiedLabel(note: DocumentSummary): string {
  return `${NOTES_LABELS.modifiedPrefix} ${formatMiniAppDateTime(
    note.updatedAt,
  )}`;
}

function isNotesSidebarAreaContextMenuTarget(
  event: MouseEvent<HTMLElement>,
): boolean {
  return (
    !(event.target instanceof Element) || !event.target.closest(".mini-app-row")
  );
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
                    <MiniAppRowActionsButton
                      aria-label={`${NOTES_LABELS.rowActionsButtonPrefix} ${title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleNoteContextMenu(event, note.id);
                      }}
                      onContextMenu={(event) => {
                        event.stopPropagation();
                        handleNoteContextMenu(event, note.id);
                      }}
                      title={`${NOTES_LABELS.rowActionsButtonPrefix} ${title}`}
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
    createNote,
    handleAreaContextMenu,
    handleNoteContextMenu,
    notes,
    ready,
    selectNote,
    selectedNoteId,
    setSidebar,
  } = params;
  // Touch layouts (phone + tablet) have no right-click, so surface the row
  // kebab in the sidebar rail too. The mobile list-home shows its own kebab.
  const showActions = useRoutedLayoutActive();
  const sidebar = useMemo(
    () => (
      <NotesSidebar
        createNote={createNote}
        handleAreaContextMenu={handleAreaContextMenu}
        handleNoteContextMenu={handleNoteContextMenu}
        notes={notes}
        ready={ready}
        selectNote={selectNote}
        selectedNoteId={selectedNoteId}
        showActions={showActions}
      />
    ),
    [
      createNote,
      handleAreaContextMenu,
      handleNoteContextMenu,
      notes,
      ready,
      selectNote,
      selectedNoteId,
      showActions,
    ],
  );

  useRegisteredWindowSidebar({ setSidebar, sidebar });
}
