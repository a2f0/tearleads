import { Loader2 } from 'lucide-react';

export function WindowSidebarLoading() {
  return (
    <div className="flex items-center justify-center py-4">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}
