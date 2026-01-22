import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { notes } from '@/db/schema';
import { NotesWindowDetail } from './NotesWindowDetail';
import { NotesWindowList } from './NotesWindowList';
import type { ViewMode } from './NotesWindowMenuBar';
import { NotesWindowMenuBar } from './NotesWindowMenuBar';
import { NotesWindowTableView } from './NotesWindowTableView';

interface NotesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function NotesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: NotesWindowProps) {
  const { isUnlocked } = useDatabaseContext();
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showMarkdownToolbar, setShowMarkdownToolbar] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  const handleSelectNote = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedNoteId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedNoteId(null);
  }, []);

  const handleNewNote = useCallback(async () => {
    if (!isUnlocked) return;

    try {
      const db = getDatabase();
      const noteId = crypto.randomUUID();
      const now = new Date();

      await db.insert(notes).values({
        id: noteId,
        title: 'Untitled Note',
        content: '',
        createdAt: now,
        updatedAt: now,
        deleted: false
      });

      setSelectedNoteId(noteId);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }, [isUnlocked]);

  return (
    <FloatingWindow
      id={id}
      title={selectedNoteId ? 'Note' : 'Notes'}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={500}
      defaultHeight={450}
      minWidth={350}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <NotesWindowMenuBar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showListTableOptions={!selectedNoteId}
          showDeleted={showDeleted}
          onShowDeletedChange={setShowDeleted}
          showMarkdownToolbarOption={Boolean(selectedNoteId)}
          showMarkdownToolbar={showMarkdownToolbar}
          onToggleMarkdownToolbar={() =>
            setShowMarkdownToolbar((prev) => !prev)
          }
          onNewNote={handleNewNote}
          onClose={onClose}
        />
        <div className="flex-1 overflow-hidden">
          {selectedNoteId ? (
            <NotesWindowDetail
              noteId={selectedNoteId}
              onBack={handleBack}
              onDeleted={handleDeleted}
              showToolbar={showMarkdownToolbar}
            />
          ) : viewMode === 'table' ? (
            <NotesWindowTableView
              onSelectNote={handleSelectNote}
              showDeleted={showDeleted}
            />
          ) : (
            <NotesWindowList
              onSelectNote={handleSelectNote}
              showDeleted={showDeleted}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
