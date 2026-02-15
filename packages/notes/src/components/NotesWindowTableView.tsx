import { notes } from '@tearleads/db/sqlite';
import { useSidebarRefetch, WindowPaneState } from '@tearleads/window-manager';
import { asc, desc, eq } from 'drizzle-orm';
import { Loader2, Plus, StickyNote } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type NoteInfo,
  useDatabaseState,
  useNotesContext,
  useNotesUI
} from '../context/NotesContext';
import { NotesContextMenus } from './shared/NotesContextMenus';
import { NotesViewHeader } from './shared/NotesViewHeader';
import { useCreateNote } from './shared/useCreateNote';
import { NotesTable } from './table-view/NotesTable';
import type { SortColumn, SortDirection } from './table-view/SortHeader';

type MenuPosition = { x: number; y: number };

interface NotesWindowTableViewProps {
  onSelectNote: (noteId: string) => void;
  showDeleted: boolean;
  refreshToken: number;
}

export function NotesWindowTableView({
  onSelectNote,
  showDeleted,
  refreshToken
}: NotesWindowTableViewProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseState();
  const { getDatabase, t, vfsKeys, auth, featureFlags, vfsApi } =
    useNotesContext();
  const { Button, ContextMenu, ContextMenuItem, InlineUnlock } = useNotesUI();
  const [notesList, setNotesList] = useState<NoteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [contextMenu, setContextMenu] = useState<{
    note: NoteInfo;
    x: number;
    y: number;
  } | null>(null);
  const [blankSpaceMenu, setBlankSpaceMenu] = useState<MenuPosition | null>(
    null
  );

  const fetchNotes = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const orderByColumn = {
        title: notes.title,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt
      }[sortColumn];

      const orderFn = sortDirection === 'asc' ? asc : desc;

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
        .orderBy(orderFn(orderByColumn));

      setNotesList(
        result.map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          deleted: row.deleted
        }))
      );
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, sortColumn, sortDirection, showDeleted, getDatabase]);

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

  const handleSortChange = useCallback((column: SortColumn) => {
    setSortColumn((prevColumn) => {
      if (prevColumn === column) {
        setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevColumn;
      }
      setSortDirection('asc');
      return column;
    });
    setHasFetched(false);
  }, []);

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
    <div className="flex h-full flex-col space-y-2 p-3">
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
                data-testid="table-empty-create-note"
              >
                <Plus className="mr-1 h-3 w-3" />
                Create
              </Button>
            }
          />
        ) : (
          <NotesTable
            notesList={notesList}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onSelectNote={onSelectNote}
            onNoteContextMenu={handleContextMenu}
            onBlankSpaceContextMenu={handleBlankSpaceContextMenu}
          />
        ))}

      <NotesContextMenus
        contextMenuPosition={
          contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null
        }
        blankSpaceMenuPosition={blankSpaceMenu}
        onCloseContextMenu={() => setContextMenu(null)}
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
