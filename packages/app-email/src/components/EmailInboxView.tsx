import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { Mail } from 'lucide-react';
import { type MouseEvent, useCallback, useState } from 'react';
import { formatEmailDate, formatEmailSize } from '../lib';
import type { EmailItem } from '../lib/email.js';
import type { ComposeMode } from '../lib/quoteText.js';
import { EmailListContextMenu } from './EmailListContextMenu.js';
import type { ViewMode } from './EmailWindowMenuBar';

interface EmailInboxViewProps {
  emails: EmailItem[];
  selectedEmailId: string | null;
  viewMode: ViewMode;
  onSelectEmail: (id: string) => void;
  onComposeForEmail?:
    | ((email: EmailItem, mode: ComposeMode) => void)
    | undefined;
}

export function EmailInboxView({
  emails,
  selectedEmailId,
  viewMode,
  onSelectEmail,
  onComposeForEmail
}: EmailInboxViewProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    email: EmailItem;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: MouseEvent, email: EmailItem) => {
      if (!onComposeForEmail) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, email });
    },
    [onComposeForEmail]
  );

  if (viewMode === 'list') {
    return (
      <div className="h-full overflow-auto">
        {emails.map((email) => (
          <button
            key={email.id}
            type="button"
            onClick={() => onSelectEmail(email.id)}
            onContextMenu={(e) => handleContextMenu(e, email)}
            className="flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-muted/50"
          >
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm">
                {email.subject || '(No Subject)'}
              </p>
              <p className="truncate text-muted-foreground text-xs">
                {email.from}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatEmailDate(email.receivedAt)}
              </p>
            </div>
          </button>
        ))}
        {contextMenu && onComposeForEmail && (
          <EmailListContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onComposeForMode={(mode) =>
              onComposeForEmail(contextMenu.email, mode)
            }
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
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>From</th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>Date</th>
            <th className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} text-right`}>
              Size
            </th>
          </tr>
        </thead>
        <tbody>
          {emails.map((email) => (
            <WindowTableRow
              key={email.id}
              onClick={() => onSelectEmail(email.id)}
              onContextMenu={(e) => handleContextMenu(e, email)}
              isSelected={selectedEmailId === email.id}
            >
              <td
                className={`max-w-[200px] truncate ${WINDOW_TABLE_TYPOGRAPHY.cell}`}
              >
                {email.subject || '(No Subject)'}
              </td>
              <td
                className={`max-w-[150px] truncate ${WINDOW_TABLE_TYPOGRAPHY.mutedCell}`}
              >
                {email.from}
              </td>
              <td
                className={`whitespace-nowrap ${WINDOW_TABLE_TYPOGRAPHY.mutedCell}`}
              >
                {formatEmailDate(email.receivedAt)}
              </td>
              <td className={`${WINDOW_TABLE_TYPOGRAPHY.mutedCell} text-right`}>
                {formatEmailSize(email.size)}
              </td>
            </WindowTableRow>
          ))}
        </tbody>
      </table>
      {contextMenu && onComposeForEmail && (
        <EmailListContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onComposeForMode={(mode) =>
            onComposeForEmail(contextMenu.email, mode)
          }
        />
      )}
    </div>
  );
}
