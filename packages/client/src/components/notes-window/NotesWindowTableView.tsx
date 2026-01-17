import { asc, desc, eq } from 'drizzle-orm';
import {
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Plus,
  StickyNote,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { RefreshButton } from '@/components/ui/refresh-button';
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
}

type SortColumn = 'title' | 'createdAt' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

interface NotesWindowTableViewProps {
  onSelectNote: (noteId: string) => void;
}

interface SortHeaderProps {
  column: SortColumn;
  label: string;
  currentColumn: SortColumn;
  direction: SortDirection;
  onClick: (column: SortColumn) => void;
}

function SortHeader({
  column,
  label,
  currentColumn,
  direction,
  onClick
}: SortHeaderProps) {
  const isActive = column === currentColumn;

  return (
    <button
      type="button"
      className="flex items-center gap-1 text-left font-medium hover:text-foreground"
      onClick={() => onClick(column)}
    >
      {label}
      {isActive && (
        <span className="shrink-0">
          {direction === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </span>
      )}
    </button>
  );
}

export function NotesWindowTableView({
  onSelectNote
}: NotesWindowTableViewProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
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
  const [blankSpaceMenu, setBlankSpaceMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

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
          updatedAt: notes.updatedAt
        })
        .from(notes)
        .where(eq(notes.deleted, false))
        .orderBy(orderFn(orderByColumn));

      setNotesList(
        result.map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }))
      );
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, sortColumn, sortDirection]);

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

  return (
    <div className="flex h-full flex-col space-y-2 p-3">
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
              data-testid="table-create-note-button"
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
              data-testid="table-empty-create-note"
            >
              <Plus className="mr-1 h-3 w-3" />
              Create
            </Button>
          </div>
        ) : (
          <div
            role="application"
            className="flex-1 overflow-auto rounded-lg border"
            onContextMenu={handleBlankSpaceContextMenu}
          >
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">
                    <SortHeader
                      column="title"
                      label="Title"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-left">
                    <SortHeader
                      column="createdAt"
                      label="Created"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-left">
                    <SortHeader
                      column="updatedAt"
                      label="Updated"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {notesList.map((note) => (
                  <tr
                    key={note.id}
                    className="cursor-pointer border-border/50 border-b hover:bg-accent/50"
                    onClick={() => onSelectNote(note.id)}
                    onContextMenu={(e) => handleContextMenu(e, note)}
                  >
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <StickyNote className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{note.title}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {formatDate(note.createdAt)}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {formatDate(note.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
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
            onClick={() => {
              setBlankSpaceMenu(null);
              handleCreateNote();
            }}
          >
            {t('newNote')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
