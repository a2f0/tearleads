import { Notes as NotesBase } from '@rapid/notes';
import { ClientNotesProvider } from '@/contexts/ClientNotesProvider';

export function Notes() {
  return (
    <ClientNotesProvider>
      <NotesBase />
    </ClientNotesProvider>
  );
}
