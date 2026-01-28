import { NotesWindow as NotesWindowBase } from '@rapid/notes';
import type { WindowDimensions } from '@rapid/window-manager';
import { ClientNotesProvider } from '@/contexts/ClientNotesProvider';

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
 * required by the @rapid/notes package.
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
      />
    </ClientNotesProvider>
  );
}
