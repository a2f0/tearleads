import { Plus, StickyNote } from 'lucide-react';
import type { NotesUIComponents } from '../../context/NotesContext';

interface NotesViewHeaderProps {
  isUnlocked: boolean;
  loading: boolean;
  createButtonTestId: string;
  onCreateNote: () => void;
  onRefresh: () => void;
  Button: NotesUIComponents['Button'];
  RefreshButton: NotesUIComponents['RefreshButton'];
}

export function NotesViewHeader({
  isUnlocked,
  loading,
  createButtonTestId,
  onCreateNote,
  onRefresh,
  Button,
  RefreshButton
}: NotesViewHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <StickyNote className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold text-sm">Notes</h2>
      </div>
      {isUnlocked && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCreateNote}
            className="h-7 px-2"
            data-testid={createButtonTestId}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <RefreshButton onClick={onRefresh} loading={loading} size="sm" />
        </div>
      )}
    </div>
  );
}
