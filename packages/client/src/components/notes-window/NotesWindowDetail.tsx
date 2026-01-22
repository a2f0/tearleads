import { useTheme } from '@rapid/ui';
import MDEditor from '@uiw/react-md-editor';
import { and, eq } from 'drizzle-orm';
import { ArrowLeft, Calendar, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
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

interface NotesWindowDetailProps {
  noteId: string;
  onBack: () => void;
  onDeleted: () => void;
  showToolbar?: boolean;
}

export function NotesWindowDetail({
  noteId,
  onBack,
  onDeleted,
  showToolbar = true
}: NotesWindowDetailProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const { resolvedTheme } = useTheme();
  const editorColorMode = resolvedTheme === 'light' ? 'light' : 'dark';
  const [note, setNote] = useState<NoteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [deleting, setDeleting] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>('');

  const fetchNote = useCallback(async () => {
    if (!isUnlocked || !noteId) return;

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
        .where(and(eq(notes.id, noteId), eq(notes.deleted, false)))
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
  }, [isUnlocked, noteId]);

  useEffect(() => {
    if (isUnlocked && noteId) {
      fetchNote();
    }
  }, [isUnlocked, noteId, fetchNote]);

  const saveContent = useCallback(
    async (newContent: string) => {
      if (!noteId || newContent === lastSavedContentRef.current) return;

      try {
        const db = getDatabase();
        await db
          .update(notes)
          .set({ content: newContent, updatedAt: new Date() })
          .where(eq(notes.id, noteId));

        lastSavedContentRef.current = newContent;
        setNote((prev) =>
          prev ? { ...prev, content: newContent, updatedAt: new Date() } : prev
        );
      } catch (err) {
        console.error('Failed to save note:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [noteId]
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
      if (content !== lastSavedContentRef.current && noteId) {
        const db = getDatabase();
        db.update(notes)
          .set({ content, updatedAt: new Date() })
          .where(eq(notes.id, noteId))
          .catch((err) => console.error('Failed to save on unmount:', err));
      }
    };
  }, [content, noteId]);

  const handleDelete = useCallback(async () => {
    if (!note) return;

    setDeleting(true);
    try {
      const db = getDatabase();
      await db
        .update(notes)
        .set({ deleted: true })
        .where(eq(notes.id, note.id));

      onDeleted();
    } catch (err) {
      console.error('Failed to delete note:', err);
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }, [note, onDeleted]);

  const handleUpdateTitle = useCallback(
    async (newTitle: string) => {
      if (!noteId) return;

      const db = getDatabase();
      await db
        .update(notes)
        .set({ title: newTitle, updatedAt: new Date() })
        .where(eq(notes.id, noteId));

      setNote((prev) =>
        prev ? { ...prev, title: newTitle, updatedAt: new Date() } : prev
      );
    },
    [noteId]
  );

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 px-2"
          data-testid="window-note-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {note && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
            data-testid="window-note-delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="this note" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading note...
        </div>
      )}

      {isUnlocked && !loading && !error && note && (
        <div className="flex min-h-0 flex-1 flex-col space-y-3">
          <EditableTitle
            value={note.title}
            onSave={handleUpdateTitle}
            data-testid="window-note-title"
          />

          <div
            className="min-h-0 flex-1"
            data-testid="window-markdown-editor"
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
            />
          </div>

          <div className="rounded-lg border text-xs">
            <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>Updated {formatDate(note.updatedAt)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
