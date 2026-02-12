import { Plus, StickyNote } from 'lucide-react';
import type { NotesUIComponents } from '../../context/NotesContext';

interface NotesEmptyStateCardProps {
  createButtonTestId: string;
  onCreateNote: () => void;
  Button: NotesUIComponents['Button'];
}

export function NotesEmptyStateCard({
  createButtonTestId,
  onCreateNote,
  Button
}: NotesEmptyStateCardProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center">
      <StickyNote className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="font-medium text-sm">No notes yet</p>
        <p className="text-muted-foreground text-xs">Create your first note</p>
      </div>
      <Button size="sm" onClick={onCreateNote} data-testid={createButtonTestId}>
        <Plus className="mr-1 h-3 w-3" />
        Create
      </Button>
    </div>
  );
}
