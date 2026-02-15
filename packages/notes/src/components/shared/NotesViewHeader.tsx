import { StickyNote } from 'lucide-react';

export function NotesViewHeader() {
  return (
    <div className="flex items-center gap-2">
      <StickyNote className="h-5 w-5 text-muted-foreground" />
      <h2 className="font-semibold text-sm">Notes</h2>
    </div>
  );
}
