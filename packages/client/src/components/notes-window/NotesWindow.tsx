import { useCallback, useState } from 'react';
import { FloatingWindow } from '@/components/floating-window';
import { NotesWindowDetail } from './NotesWindowDetail';
import { NotesWindowList } from './NotesWindowList';

interface NotesWindowProps {
  id: string;
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

export function NotesWindow({
  id,
  onClose,
  onFocus,
  zIndex
}: NotesWindowProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const handleSelectNote = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedNoteId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedNoteId(null);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title={selectedNoteId ? 'Note' : 'Notes'}
      onClose={onClose}
      onFocus={onFocus}
      zIndex={zIndex}
      defaultWidth={500}
      defaultHeight={450}
      minWidth={350}
      minHeight={300}
    >
      {selectedNoteId ? (
        <NotesWindowDetail
          noteId={selectedNoteId}
          onBack={handleBack}
          onDeleted={handleDeleted}
        />
      ) : (
        <NotesWindowList onSelectNote={handleSelectNote} />
      )}
    </FloatingWindow>
  );
}
