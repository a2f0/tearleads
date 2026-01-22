import { useTheme } from '@rapid/ui';
import MDEditor, { commands } from '@uiw/react-md-editor';
import { and, eq } from 'drizzle-orm';
import { Calendar, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ActionToolbar, type ActionType } from '@/components/ui/action-toolbar';
import { BackLink } from '@/components/ui/back-link';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { EditableTitle } from '@/components/ui/editable-title';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { notes } from '@/db/schema';
import { markdownToolbarCommandsFilter } from '@/lib/markdown-toolbar';
import { formatDate } from '@/lib/utils';

interface NoteInfo {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isUnlocked, isLoading } = useDatabaseContext();
  const { resolvedTheme } = useTheme();
  const editorColorMode = resolvedTheme === 'light' ? 'light' : 'dark';
  const [note, setNote] = useState<NoteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<ActionType | null>(null);
  const [content, setContent] = useState<string>('');
  const [showToolbar, setShowToolbar] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>('');

  const fetchNote = useCallback(async () => {
    if (!isUnlocked || !id) return;

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
        .where(and(eq(notes.id, id), eq(notes.deleted, false)))
        .limit(1);

      const row = result[0];
      if (!row) {
        setError('Note not found');
        return;
      }

      const noteInfo: NoteInfo = {
        id: row.id,
        title: row.title,
        content: row.content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      };
      setNote(noteInfo);
      setContent(noteInfo.content);
      lastSavedContentRef.current = noteInfo.content;
    } catch (err) {
      console.error('Failed to fetch note:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, id]);

  useEffect(() => {
    if (isUnlocked && id) {
      fetchNote();
    }
  }, [isUnlocked, id, fetchNote]);

  const saveContent = useCallback(
    async (newContent: string) => {
      if (!id || newContent === lastSavedContentRef.current) return;

      try {
        const db = getDatabase();
        await db
          .update(notes)
          .set({ content: newContent, updatedAt: new Date() })
          .where(eq(notes.id, id));

        lastSavedContentRef.current = newContent;
        setNote((prev) =>
          prev ? { ...prev, content: newContent, updatedAt: new Date() } : prev
        );
      } catch (err) {
        console.error('Failed to save note:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [id]
  );

  const handleContentChange = useCallback(
    (value: string | undefined) => {
      const newContent = value ?? '';
      setContent(newContent);

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        saveContent(newContent);
      }, 500);
    },
    [saveContent]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (content !== lastSavedContentRef.current && id) {
        const db = getDatabase();
        db.update(notes)
          .set({ content, updatedAt: new Date() })
          .where(eq(notes.id, id))
          .catch((err) => console.error('Failed to save on unmount:', err));
      }
    };
  }, [content, id]);

  const handleDelete = useCallback(async () => {
    if (!note) return;

    setActionLoading('delete');
    try {
      const db = getDatabase();
      await db
        .update(notes)
        .set({ deleted: true })
        .where(eq(notes.id, note.id));

      navigate('/notes');
    } catch (err) {
      console.error('Failed to delete note:', err);
      setError(err instanceof Error ? err.message : String(err));
      setActionLoading(null);
    }
  }, [note, navigate]);

  const handleUpdateTitle = useCallback(
    async (newTitle: string) => {
      if (!id) return;

      const db = getDatabase();
      await db
        .update(notes)
        .set({ title: newTitle, updatedAt: new Date() })
        .where(eq(notes.id, id));

      setNote((prev) =>
        prev ? { ...prev, title: newTitle, updatedAt: new Date() } : prev
      );
    },
    [id]
  );

  const handleToggleToolbar = useCallback(() => {
    setShowToolbar((prev) => !prev);
  }, []);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="flex items-center justify-between gap-4">
        <BackLink defaultTo="/notes" defaultLabel="Back to Notes" />
        <DropdownMenu trigger="View" align="right">
          <DropdownMenuItem onClick={handleToggleToolbar} checked={showToolbar}>
            Markdown Toolbar
          </DropdownMenuItem>
        </DropdownMenu>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="this note" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading note...
        </div>
      )}

      {isUnlocked && !loading && !error && note && (
        <div className="flex min-h-0 flex-1 flex-col space-y-6">
          <EditableTitle
            value={note.title}
            onSave={handleUpdateTitle}
            data-testid="note-title"
          />

          <div
            className="min-h-0 flex-1"
            data-testid="markdown-editor"
            data-color-mode={editorColorMode}
          >
            <MDEditor
              value={content}
              onChange={handleContentChange}
              height="100%"
              preview="edit"
              hideToolbar={!showToolbar}
              visibleDragbar={false}
              commandsFilter={markdownToolbarCommandsFilter}
              extraCommands={[
                commands.codeEdit,
                commands.codePreview,
                commands.divider,
                commands.fullscreen
              ]}
            />
          </div>

          <ActionToolbar
            onDelete={handleDelete}
            loadingAction={actionLoading}
            canShare={false}
          />

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Note Details</h2>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Created</span>
                <span className="ml-auto text-sm">
                  {formatDate(note.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Updated</span>
                <span className="ml-auto text-sm">
                  {formatDate(note.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
