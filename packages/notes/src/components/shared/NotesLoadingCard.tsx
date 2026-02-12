import { Loader2 } from 'lucide-react';

export function NotesLoadingCard() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading notes...
    </div>
  );
}
