import { NotesWindow as NotesWindowBase } from '@tearleads/notes';
import type { WindowDimensions } from '@tearleads/window-manager';
import { ClientNotesProvider } from '@/contexts/ClientNotesProvider';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';

interface NotesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

/**
 * NotesWindow wrapped with ClientNotesProvider.
 * This provides all the dependencies (database, UI components, translations)
 * required by the @tearleads/notes package.
 */
export function NotesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: NotesWindowProps) {
  const openRequest = useWindowOpenRequest('notes');

  return (
    <ClientNotesProvider>
      <NotesWindowBase
        id={id}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onFocus={onFocus}
        zIndex={zIndex}
        initialDimensions={initialDimensions}
        openNoteId={openRequest?.noteId}
        openRequestId={openRequest?.requestId}
      />
    </ClientNotesProvider>
  );
}
