import { useVirtualizer } from '@tanstack/react-virtual';
import { notes } from '@tearleads/db/sqlite';
import { useSidebarRefetch, WindowPaneState } from '@tearleads/window-manager';
import { desc, eq } from 'drizzle-orm';
import { Loader2, Plus, StickyNote } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type NoteInfo,
  useDatabaseState,
  useNotesContext,
  useNotesUI
} from '../context/NotesContext';
import { NoteItemContent } from './list-view/NoteItemContent';
import { NotesContextMenus } from './shared/NotesContextMenus';
import { NotesViewHeader } from './shared/NotesViewHeader';
import { useCreateNote } from './shared/useCreateNote';

type MenuPosition = { x: number; y: number };

const ROW_HEIGHT_ESTIMATE = 56;

interface NotesWindowListProps {
  onSelectNote: (noteId: string) => void;
  showDeleted: boolean;
  refreshToken: number;
}

export function NotesWindowList({
  onSelectNote,
  showDeleted,
  refreshToken
}: NotesWindowListProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseState();
  const { getDatabase, t, vfsKeys, auth, featureFlags, vfsApi } =
    useNotesContext();
  const {
    Button,
    Input,
    ContextMenu,
    ContextMenuItem,
    ListRow,
    VirtualListStatus,
    InlineUnlock
  } = useNotesUI();
  const [notesList, setNotesList] = useState<NoteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    note: NoteInfo;
    x: number;
    y: number;
  } | null>(null);
  const [blankSpaceMenu, setBlankSpaceMenu] = useState<MenuPosition | null>(
    null
  );
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredNotes = notesList.filter((note) =>
    note.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const virtualizer = useVirtualizer({
    count: filteredNotes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();
  const firstVisible =
    virtualItems.length > 0 ? (virtualItems[0]?.index ?? 0) : 0;
  const lastVisible =
    virtualItems.length > 0
      ? (virtualItems[virtualItems.length - 1]?.index ?? 0)
      : 0;

  const fetchNotes = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const result = await db
        .select({
          id: notes.id,
          title: notes.title,
          content: notes.content,
          createdAt: notes.createdAt,
          updatedAt: notes.updatedAt,
          deleted: notes.deleted
        })
        .from(notes)
        .where(showDeleted ? undefined : eq(notes.deleted, false))
        .orderBy(desc(notes.updatedAt));

      const noteList: NoteInfo[] = result.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deleted: row.deleted
      }));

      setNotesList(noteList);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, showDeleted, getDatabase]);

  const fetchedForInstanceRef = useRef<string | null>(null);
  const lastShowDeletedRef = useRef(showDeleted);

  // Use standardized hook for refresh token tracking
  const triggerRefetch = useCallback(() => {
    setHasFetched(false);
  }, []);
  useSidebarRefetch(refreshToken, triggerRefetch);

  useEffect(() => {
    const showDeletedChanged = lastShowDeletedRef.current !== showDeleted;
    if (showDeletedChanged) {
      lastShowDeletedRef.current = showDeleted;
    }

    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched ||
        fetchedForInstanceRef.current !== currentInstanceId ||
        showDeletedChanged);

    if (needsFetch) {
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        setNotesList([]);
        setError(null);
      }

      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchNotes();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [
    isUnlocked,
    loading,
    hasFetched,
    currentInstanceId,
    fetchNotes,
    showDeleted
  ]);

  const handleNoteClick = useCallback(
    (note: NoteInfo) => {
      if (note.deleted) return;
      onSelectNote(note.id);
    },
    [onSelectNote]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, note: NoteInfo) => {
      if (note.deleted) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ note, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      onSelectNote(contextMenu.note.id);
      setContextMenu(null);
    }
  }, [contextMenu, onSelectNote]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(notes)
        .set({ deleted: true })
        .where(eq(notes.id, contextMenu.note.id));

      setHasFetched(false);
    } catch (err) {
      console.error('Failed to delete note:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, getDatabase]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleBlankSpaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setBlankSpaceMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCreateNote = useCreateNote({
    getDatabase,
    onSelectNote,
    onError: setError,
    vfsKeys,
    auth,
    featureFlags,
    vfsApi
  });

  const handleCreateNoteFromMenu = useCallback(() => {
    setBlankSpaceMenu(null);
    handleCreateNote();
  }, [handleCreateNote]);

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      <NotesViewHeader />

      {isLoading && (
        <WindowPaneState
          layout="inline"
          title="Loading database..."
          className="text-center"
        />
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="notes" />}

      {error && <WindowPaneState layout="inline" tone="error" title={error} />}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <WindowPaneState
            layout="inline"
            icon={<Loader2 className="h-4 w-4 animate-spin" />}
            title="Loading notes..."
          />
        ) : notesList.length === 0 && hasFetched ? (
          <WindowPaneState
            icon={<StickyNote className="h-8 w-8 text-muted-foreground" />}
            title="No notes yet"
            description="Create your first note"
            action={
              <Button
                size="sm"
                onClick={handleCreateNote}
                data-testid="window-empty-create-note"
              >
                <Plus className="mr-1 h-3 w-3" />
                Create
              </Button>
            }
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col space-y-2">
            <Input
              type="search"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-sm"
              data-testid="window-notes-search"
            />
            <VirtualListStatus
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              loadedCount={filteredNotes.length}
              itemLabel="note"
            />
            <div className="flex-1 rounded-lg border">
              <div
                ref={parentRef}
                role="application"
                className="h-full overflow-auto"
                onContextMenu={handleBlankSpaceContextMenu}
              >
                <div
                  className="relative w-full"
                  style={{ height: `${virtualizer.getTotalSize()}px` }}
                >
                  {virtualItems.map((virtualItem) => {
                    const note = filteredNotes[virtualItem.index];
                    if (!note) return null;

                    return (
                      <div
                        key={note.id}
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        className="absolute top-0 left-0 w-full px-1 py-0.5"
                        style={{
                          transform: `translateY(${virtualItem.start}px)`
                        }}
                      >
                        <ListRow
                          className={note.deleted ? 'opacity-60' : ''}
                          onContextMenu={
                            note.deleted
                              ? undefined
                              : (e) => handleContextMenu(e, note)
                          }
                        >
                          {note.deleted ? (
                            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left">
                              <NoteItemContent note={note} />
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden text-left"
                              onClick={() => handleNoteClick(note)}
                            >
                              <NoteItemContent note={note} />
                            </button>
                          )}
                        </ListRow>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}

      <NotesContextMenus
        contextMenuPosition={
          contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null
        }
        blankSpaceMenuPosition={blankSpaceMenu}
        onCloseContextMenu={handleCloseContextMenu}
        onCloseBlankSpaceMenu={() => setBlankSpaceMenu(null)}
        onGetInfo={handleGetInfo}
        onDelete={handleDelete}
        onCreateNoteFromMenu={handleCreateNoteFromMenu}
        t={t}
        ContextMenu={ContextMenu}
        ContextMenuItem={ContextMenuItem}
      />
    </div>
  );
}
