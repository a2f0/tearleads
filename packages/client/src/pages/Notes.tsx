import { useVirtualizer } from '@tanstack/react-virtual';
import { desc, eq } from 'drizzle-orm';
import { Info, Loader2, StickyNote, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { notes } from '@/db/schema';
import { useTypedTranslation } from '@/i18n';
import { useNavigateWithFrom } from '@/lib/navigation';
import { formatDate } from '@/lib/utils';
import { AddNoteCard } from './notes/AddNoteCard';

interface NoteInfo {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const ROW_HEIGHT_ESTIMATE = 56;

export function Notes() {
  const navigateWithFrom = useNavigateWithFrom();
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
          updatedAt: notes.updatedAt
        })
        .from(notes)
        .where(eq(notes.deleted, false))
        .orderBy(desc(notes.updatedAt));

      const noteList: NoteInfo[] = result.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }));

      setNotesList(noteList);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

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

  const handleNoteClick = useCallback(
    (note: NoteInfo) => {
      navigateWithFrom(`/notes/${note.id}`, {
        fromLabel: 'Back to Notes'
      });
    },
    [navigateWithFrom]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, note: NoteInfo) => {
      e.preventDefault();
      setContextMenu({ note, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      navigateWithFrom(`/notes/${contextMenu.note.id}`, {
        fromLabel: 'Back to Notes'
      });
      setContextMenu(null);
    }
  }, [contextMenu, navigateWithFrom]);

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

      navigateWithFrom(`/notes/${id}`, {
        fromLabel: 'Back to Notes'
      });
    } catch (err) {
      console.error('Failed to create note:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [navigateWithFrom]);

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
    <div className="flex h-full flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StickyNote className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Notes</h1>
        </div>
        {isUnlocked && <RefreshButton onClick={fetchNotes} loading={loading} />}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="notes" />}

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading notes...
          </div>
        ) : notesList.length === 0 && hasFetched ? (
          <AddNoteCard onClick={handleCreateNote} size="large" />
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col space-y-2"
            data-testid="notes-list"
          >
            <div className="flex items-center gap-2">
              <Input
                type="search"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm"
                data-testid="notes-search"
              />
            </div>
            <VirtualListStatus
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              loadedCount={filteredNotes.length}
              itemLabel="note"
            />
            <div className="flex-1 rounded-lg border">
              <div ref={parentRef} className="h-full overflow-auto">
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
                          onContextMenu={(e) => handleContextMenu(e, note)}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                            onClick={() => handleNoteClick(note)}
                          >
                            <StickyNote className="h-5 w-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-sm">
                                {note.title}
                              </p>
                              <p className="truncate text-muted-foreground text-xs">
                                {getContentPreview(note.content)} ·{' '}
                                {formatDate(note.updatedAt)}
                              </p>
                            </div>
                          </button>
                        </ListRow>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <AddNoteCard onClick={handleCreateNote} size="small" />
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
    </div>
  );
}
