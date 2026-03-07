import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { Loader2, Mail } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEmailBody } from '../hooks/useEmailBody.js';
import { formatEmailDate, formatEmailSize } from '../lib';
import type { EmailItem } from '../lib/email.js';
import type { ComposeMode } from '../lib/quoteText.js';
import { ComposeDialog } from './compose/ComposeDialog.js';
import type { ViewMode } from './EmailWindowMenuBar';
import { EmailBodyView } from './emailBody/EmailBodyView.js';

export type { ComposeMode };

export interface ComposeOpenRequest {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  composeMode?: ComposeMode;
  requestId: number;
}

interface EmailWindowContentProps {
  isDatabaseLoading: boolean;
  isUnlocked: boolean;
  lockedFallback: ReactNode;
  activeTab: 'inbox' | 'compose';
  onCloseCompose: () => void;
  onEmailSent: () => void;
  composeOpenRequest: ComposeOpenRequest | null;
  loading: boolean;
  error: string | null;
  selectedEmailId: string | null;
  selectedEmail: EmailItem | undefined;
  isListBackedFolder: boolean;
  selectedFolderName: string;
  emails: EmailItem[];
  onSelectEmail: (id: string) => void;
  viewMode: ViewMode;
}

export function EmailWindowContent({
  isDatabaseLoading,
  isUnlocked,
  lockedFallback,
  activeTab,
  onCloseCompose,
  onEmailSent,
  composeOpenRequest,
  loading,
  error,
  selectedEmailId,
  selectedEmail,
  isListBackedFolder,
  selectedFolderName,
  emails,
  onSelectEmail,
  viewMode
}: EmailWindowContentProps) {
  const {
    body: emailBody,
    loading: bodyLoading,
    error: bodyError,
    viewMode: bodyViewMode,
    setViewMode: setBodyViewMode
  } = useEmailBody(selectedEmailId);

  if (isDatabaseLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading database...
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        {lockedFallback}
      </div>
    );
  }

  if (activeTab === 'compose') {
    return (
      <ComposeDialog
        open
        onOpenChange={onCloseCompose}
        onEmailSent={onEmailSent}
        {...(composeOpenRequest && { openRequest: composeOpenRequest })}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-destructive text-sm">{error}</div>;
  }

  if (selectedEmailId && selectedEmail) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b p-3">
          <h2 className="font-medium text-sm">
            {selectedEmail.subject || '(No Subject)'}
          </h2>
          <p className="text-muted-foreground text-xs">
            From: {selectedEmail.from}
          </p>
          <p className="text-muted-foreground text-xs">
            To: {selectedEmail.to.join(', ')}
          </p>
          {selectedEmail.cc && selectedEmail.cc.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Cc: {selectedEmail.cc.join(', ')}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {formatEmailDate(selectedEmail.receivedAt)} ·{' '}
            {formatEmailSize(selectedEmail.size)}
          </p>
        </div>
        <div className="flex-1 overflow-auto">
          <EmailBodyView
            body={emailBody}
            loading={bodyLoading}
            error={bodyError}
            viewMode={bodyViewMode}
            onViewModeChange={setBodyViewMode}
          />
        </div>
      </div>
    );
  }

  if (!isListBackedFolder) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Mail className="h-8 w-8" />
        <p className="text-sm">No emails in {selectedFolderName}</p>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Mail className="h-8 w-8" />
        <p className="text-sm">No emails yet</p>
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="h-full overflow-auto">
        {emails.map((email) => (
          <button
            key={email.id}
            type="button"
            onClick={() => onSelectEmail(email.id)}
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
    </div>
  );
}
