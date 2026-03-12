import { Loader2, Mail } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEmailBody } from '../hooks/useEmailBody.js';
import { formatEmailDate, formatEmailSize } from '../lib';
import type { EmailItem } from '../lib/email.js';
import type { ComposeMode } from '../lib/quoteText.js';
import type { DraftListItem } from '../types';
import { ComposeDialog } from './compose/ComposeDialog.js';
import { DraftListView } from './DraftListView.js';
import { EmailInboxView } from './EmailInboxView.js';
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
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    size: number;
    content: string;
  }>;

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
  composeDraftId?: string | null;
  loading: boolean;
  error: string | null;
  selectedEmailId: string | null;
  selectedEmail: EmailItem | undefined;
  isListBackedFolder: boolean;
  isDraftsFolder: boolean;
  selectedFolderName: string;
  emails: EmailItem[];
  drafts: DraftListItem[];
  draftsLoading: boolean;
  onSelectEmail: (id: string) => void;
  viewMode: ViewMode;
  onComposeForEmail?: (email: EmailItem, mode: ComposeMode) => void;
  onEditDraft?: (id: string) => void;
  onDeleteDraft?: (id: string) => void;
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
  isDraftsFolder,
  selectedFolderName,
  emails,
  drafts,
  draftsLoading,
  onSelectEmail,
  viewMode,
  onComposeForEmail,
  composeDraftId,
  onEditDraft,
  onDeleteDraft
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
        {...(composeDraftId && { draftId: composeDraftId })}
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

  if (isDraftsFolder) {
    return (
      <DraftListView
        drafts={drafts}
        loading={draftsLoading}
        folderName={selectedFolderName}
        viewMode={viewMode}
        onEditDraft={onEditDraft ?? (() => {})}
        onDeleteDraft={onDeleteDraft ?? (() => {})}
      />
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

  return (
    <EmailInboxView
      emails={emails}
      selectedEmailId={selectedEmailId}
      viewMode={viewMode}
      onSelectEmail={onSelectEmail}
      onComposeForEmail={onComposeForEmail}
    />
  );
}
