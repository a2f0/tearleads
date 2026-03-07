// component-complexity: allow -- Notes detail currently co-locates save orchestration with UI.
import { notes } from '@tearleads/db/sqlite';
import { useTheme } from '@tearleads/ui';
import MDEditor from '@uiw/react-md-editor';

import { and, eq } from 'drizzle-orm';
import { Calendar, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useDatabaseState,
  useNotesContext,
  useNotesUI
} from '../context/NotesContext';
import { createMarkdownToolbarFilter } from '../lib/markdownToolbar';
import { formatDate } from '../lib/utils';

interface NoteInfo {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

interface NotesWindowDetailProps {
  noteId: string;
  showToolbar?: boolean;
}

export function NotesWindowDetail({
  noteId,
  showToolbar = true
}: NotesWindowDetailProps) {
  const { isUnlocked, isLoading } = useDatabaseState();
  const { getDatabase, tooltipZIndex, vfsItemSync } = useNotesContext();
  const { InlineUnlock, EditableTitle } = useNotesUI();
  const { resolvedTheme } = useTheme();
  const editorColorMode = resolvedTheme === 'light' ? 'light' : 'dark';
  const [note, setNote] = useState<NoteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>('');
  const contentRef = useRef<string>('');

  const markdownToolbarCommandsFilter =
    createMarkdownToolbarFilter(tooltipZIndex);

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
      contentRef.current = noteInfo.content;
      lastSavedContentRef.current = noteInfo.content;
    } catch (err) {
      console.error('Failed to fetch note:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, noteId, getDatabase]);

  useEffect(() => {
    if (isUnlocked && noteId) {
      fetchNote();
    }
  }, [isUnlocked, noteId, fetchNote]);

  const saveContent = useCallback(
    async (newContent: string) => {
      if (!noteId || newContent === lastSavedContentRef.current) return;

      try {
        const updatedAt = new Date();
        const db = getDatabase();
        await db
          .update(notes)
          .set({ content: newContent, updatedAt })
          .where(eq(notes.id, noteId));

        if (vfsItemSync) {
          await vfsItemSync.queueItemUpsertAndFlush({
            itemId: noteId,
            objectType: 'note',
            payload: {
              id: noteId,
              objectType: 'note',
              title: note?.title ?? '',
              content: newContent,
              deleted: false,
              updatedAt: updatedAt.toISOString()
            }
          });
        }

        lastSavedContentRef.current = newContent;
        setNote((prev) =>
          prev ? { ...prev, content: newContent, updatedAt } : prev
        );
      } catch (err) {
        console.error('Failed to save note:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [noteId, getDatabase, note?.title, vfsItemSync]
  );

  const handleContentChange = useCallback(
    (value: string | undefined) => {
      const newContent = value ?? '';
      setContent(newContent);
      contentRef.current = newContent;

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
      if (contentRef.current !== lastSavedContentRef.current && noteId) {
        const updatedAt = new Date();
        const db = getDatabase();
        db.update(notes)
          .set({ content: contentRef.current, updatedAt })
          .where(eq(notes.id, noteId))
          .then(async () => {
            if (vfsItemSync) {
              await vfsItemSync.queueItemUpsertAndFlush({
                itemId: noteId,
                objectType: 'note',
                payload: {
                  id: noteId,
                  objectType: 'note',
                  title: note?.title ?? '',
                  content: contentRef.current,
                  deleted: false,
                  updatedAt: updatedAt.toISOString()
                }
              });
            }
            lastSavedContentRef.current = contentRef.current;
          })
          .catch((err: unknown) =>
            console.error('Failed to save on unmount:', err)
          );
      }
    };
  }, [noteId, getDatabase, note?.title, vfsItemSync]);

  const handleUpdateTitle = useCallback(
    async (newTitle: string) => {
      if (!noteId) return;

      const updatedAt = new Date();
      const db = getDatabase();
      await db
        .update(notes)
        .set({ title: newTitle, updatedAt })
        .where(eq(notes.id, noteId));

      if (vfsItemSync) {
        await vfsItemSync.queueItemUpsertAndFlush({
          itemId: noteId,
          objectType: 'note',
          payload: {
            id: noteId,
            objectType: 'note',
            title: newTitle,
            content,
            deleted: false,
            updatedAt: updatedAt.toISOString()
          }
        });
      }

      setNote((prev) =>
        prev ? { ...prev, title: newTitle, updatedAt } : prev
      );
    },
    [noteId, getDatabase, content, vfsItemSync]
  );

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs [border-color:var(--soft-border)]">
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
        <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs [border-color:var(--soft-border)]">
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
              autoFocus
            />
          </div>

          <div className="rounded-lg border text-xs [border-color:var(--soft-border)]">
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
