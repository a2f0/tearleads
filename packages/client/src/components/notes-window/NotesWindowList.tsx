import { useVirtualizer } from '@tanstack/react-virtual';
import { desc, eq, or } from 'drizzle-orm';
import { Info, Loader2, Plus, StickyNote, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { notes } from '@/db/schema';
import { useTypedTranslation } from '@/i18n';
import { formatDate } from '@/lib/utils';

interface NoteInfo {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deleted: boolean;
}

type MenuPosition = { x: number; y: number };

const ROW_HEIGHT_ESTIMATE = 56;

interface NotesWindowListProps {
  onSelectNote: (noteId: string) => void;
  showDeleted: boolean;
}

export function NotesWindowList({
  onSelectNote,
  showDeleted
}: NotesWindowListProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
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
        .where(
          showDeleted
            ? or(eq(notes.deleted, false), eq(notes.deleted, true))
            : eq(notes.deleted, false)
        )
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
  }, [isUnlocked, showDeleted]);

  const fetchedForInstanceRef = useRef<string | null>(null);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

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
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchNotes]);

  useEffect(() => {
    setHasFetched(false);
  }, [showDeleted]);

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
  }, [contextMenu]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleBlankSpaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setBlankSpaceMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCreateNote = useCallback(async () => {
    try {
      const db = getDatabase();
      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(notes).values({
        id,
        title: 'Untitled Note',
        content: '',
        createdAt: now,
        updatedAt: now,
        deleted: false
      });

      onSelectNote(id);
    } catch (err) {
      console.error('Failed to create note:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [onSelectNote]);

  const handleCreateNoteFromMenu = useCallback(() => {
    setBlankSpaceMenu(null);
    handleCreateNote();
  }, [handleCreateNote]);

  const getContentPreview = (content: string) => {
    const plainText = content
      .replace(/^#+\s/gm, '')
      .replace(/[*_`[\]~]/g, '')
      .trim();
    if (plainText.length > 100) {
      return `${plainText.substring(0, 100)}...`;
    }
    return plainText || 'No content';
  };

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StickyNote className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Notes</h2>
        </div>
        {isUnlocked && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCreateNote}
              className="h-7 px-2"
              data-testid="window-create-note-button"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <RefreshButton onClick={fetchNotes} loading={loading} size="sm" />
          </div>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="notes" />}

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading notes...
          </div>
        ) : notesList.length === 0 && hasFetched ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center">
            <StickyNote className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">No notes yet</p>
              <p className="text-muted-foreground text-xs">
                Create your first note
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleCreateNote}
              data-testid="window-empty-create-note"
            >
              <Plus className="mr-1 h-3 w-3" />
              Create
            </Button>
          </div>
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
                              <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-xs line-through">
                                  {note.title}
                                </p>
                                <p className="truncate text-muted-foreground text-xs">
                                  {getContentPreview(note.content)} ·{' '}
                                  {formatDate(note.updatedAt)} · Deleted
                                </p>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden text-left"
                              onClick={() => handleNoteClick(note)}
                            >
                              <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-xs">
                                  {note.title}
                                </p>
                                <p className="truncate text-muted-foreground text-xs">
                                  {getContentPreview(note.content)} ·{' '}
                                  {formatDate(note.updatedAt)}
                                </p>
                              </div>
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={handleGetInfo}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleDelete}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}

      {blankSpaceMenu && (
        <ContextMenu
          x={blankSpaceMenu.x}
          y={blankSpaceMenu.y}
          onClose={() => setBlankSpaceMenu(null)}
        >
          <ContextMenuItem
            icon={<Plus className="h-4 w-4" />}
            onClick={handleCreateNoteFromMenu}
          >
            {t('newNote')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
