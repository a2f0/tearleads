import { notes } from '@tearleads/db/sqlite';
import { asc, desc, eq } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type NoteInfo,
  useDatabaseState,
  useNotesContext,
  useNotesUI
} from '../context/NotesContext';
import { DatabaseLoadingCard } from './shared/DatabaseLoadingCard';
import { NotesContextMenus } from './shared/NotesContextMenus';
import { NotesEmptyStateCard } from './shared/NotesEmptyStateCard';
import { NotesLoadingCard } from './shared/NotesLoadingCard';
import { NotesViewHeader } from './shared/NotesViewHeader';
import { useCreateNote } from './shared/useCreateNote';
import { NotesTable } from './table-view/NotesTable';
import type { SortColumn, SortDirection } from './table-view/SortHeader';

type MenuPosition = { x: number; y: number };

interface NotesWindowTableViewProps {
  onSelectNote: (noteId: string) => void;
  showDeleted: boolean;
}

export function NotesWindowTableView({
  onSelectNote,
  showDeleted
}: NotesWindowTableViewProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseState();
  const { getDatabase, t, vfsKeys, auth, featureFlags, vfsApi } =
    useNotesContext();
  const { Button, ContextMenu, ContextMenuItem, RefreshButton, InlineUnlock } =
    useNotesUI();
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
      <NotesViewHeader
        isUnlocked={isUnlocked}
        loading={loading}
        createButtonTestId="table-create-note-button"
        onCreateNote={handleCreateNote}
        onRefresh={fetchNotes}
        Button={Button}
        RefreshButton={RefreshButton}
      />

      {isLoading && <DatabaseLoadingCard />}

      {!isLoading && !isUnlocked && <InlineUnlock description="notes" />}

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <NotesLoadingCard />
        ) : notesList.length === 0 && hasFetched ? (
          <NotesEmptyStateCard
            createButtonTestId="table-empty-create-note"
            onCreateNote={handleCreateNote}
            Button={Button}
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
