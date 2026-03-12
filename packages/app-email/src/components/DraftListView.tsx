import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { FileEdit, Loader2, Mail } from 'lucide-react';
import { type MouseEvent, useCallback, useState } from 'react';
import { formatEmailDate } from '../lib';
import type { DraftListItem } from '../types';
import { DraftListContextMenu } from './DraftListContextMenu.js';
import type { ViewMode } from './EmailWindowMenuBar';

interface DraftListViewProps {
  drafts: DraftListItem[];
  loading: boolean;
  folderName: string;
  viewMode: ViewMode;
  onEditDraft: (id: string) => void;
  onDeleteDraft: (id: string) => void;
}

export function DraftListView({
  drafts,
  loading,
  folderName,
  viewMode,
  onEditDraft,
  onDeleteDraft
}: DraftListViewProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    draft: DraftListItem;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: MouseEvent, draft: DraftListItem) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, draft });
    },
    []
  );

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

  if (viewMode === 'list') {
    return (
      <div className="h-full overflow-auto">
        {drafts.map((draft) => (
          <button
            key={draft.id}
            type="button"
            onClick={() => onEditDraft(draft.id)}
            onContextMenu={(e) => handleContextMenu(e, draft)}
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
        {contextMenu && (
          <DraftListContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onEdit={() => onEditDraft(contextMenu.draft.id)}
            onDelete={() => onDeleteDraft(contextMenu.draft.id)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
        <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
          <tr>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>Subject</th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>To</th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>Date</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => (
            <WindowTableRow
              key={draft.id}
              onClick={() => onEditDraft(draft.id)}
              onContextMenu={(e) => handleContextMenu(e, draft)}
            >
              <td
                className={`max-w-[200px] truncate ${WINDOW_TABLE_TYPOGRAPHY.cell}`}
              >
                {draft.subject || '(No Subject)'}
              </td>
              <td
                className={`max-w-[150px] truncate ${WINDOW_TABLE_TYPOGRAPHY.mutedCell}`}
              >
                {draft.to.length > 0 ? draft.to.join(', ') : 'No recipients'}
              </td>
              <td
                className={`whitespace-nowrap ${WINDOW_TABLE_TYPOGRAPHY.mutedCell}`}
              >
                {formatEmailDate(draft.updatedAt)}
              </td>
            </WindowTableRow>
          ))}
        </tbody>
      </table>
      {contextMenu && (
        <DraftListContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onEdit={() => onEditDraft(contextMenu.draft.id)}
          onDelete={() => onDeleteDraft(contextMenu.draft.id)}
        />
      )}
    </div>
  );
}
