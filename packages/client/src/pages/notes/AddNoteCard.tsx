import { Plus, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AddNoteCardProps {
  onClick: () => void;
  size?: 'large' | 'small';
}

export function AddNoteCard({ onClick, size = 'large' }: AddNoteCardProps) {
  const isLarge = size === 'large';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-center gap-4 rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-foreground',
        isLarge ? 'p-8' : 'p-4'
      )}
      data-testid="add-note-card"
    >
      <StickyNote className={isLarge ? 'h-8 w-8' : 'h-5 w-5'} />
      <span className={cn('font-medium', !isLarge && 'text-sm')}>
        Add new note
      </span>
      <Plus className={isLarge ? 'h-6 w-6' : 'h-4 w-4'} />
    </button>
  );
}
