import { FileEdit, Loader2, Mail } from 'lucide-react';
import { formatEmailDate } from '../lib';
import type { DraftListItem } from '../types';

interface DraftListViewProps {
  drafts: DraftListItem[];
  loading: boolean;
  folderName: string;
}

export function DraftListView({
  drafts,
  loading,
  folderName
}: DraftListViewProps) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Mail className="h-8 w-8" />
        <p className="text-sm">No emails in {folderName}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {drafts.map((draft) => (
        <button
          key={draft.id}
          type="button"
          className="flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-muted/50"
        >
          <FileEdit className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">
              {draft.subject || '(No Subject)'}
            </p>
            <p className="truncate text-muted-foreground text-xs">
              {draft.to.length > 0
                ? `To: ${draft.to.join(', ')}`
                : 'No recipients'}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatEmailDate(draft.updatedAt)}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
