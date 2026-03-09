import { Notes as NotesBase } from '@tearleads/app-notes';
import { ClientNotesProvider } from '@/contexts/ClientNotesProvider';

export function Notes() {
  return (
    <ClientNotesProvider>
      <NotesBase />
    </ClientNotesProvider>
  );
}
