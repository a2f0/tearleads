import {
  FloatingWindow,
  WINDOW_TABLE_TYPOGRAPHY,
  type WindowDimensions,
  WindowTableRow
} from '@rapid/window-manager';
import { Loader2, Mail, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useHasEmailFolderOperations } from '../context/EmailContext.js';
import { useEmails } from '../hooks';
import { formatEmailDate, formatEmailSize } from '../lib';
import { ALL_MAIL_ID, type EmailFolder } from '../types/folder.js';
import { ComposeDialog } from './compose/ComposeDialog.js';
import type { ViewMode } from './EmailWindowMenuBar';
import { EmailWindowMenuBar } from './EmailWindowMenuBar';
import { EmailFoldersSidebar } from './sidebar/EmailFoldersSidebar.js';

const DEFAULT_SIDEBAR_WIDTH = 180;

interface ComposeOpenRequest {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  requestId: number;
}

interface EmailWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  openComposeRequest?: ComposeOpenRequest;
}

export function EmailWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions,
  openComposeRequest
}: EmailWindowProps) {
  type MainTab = 'inbox' | 'compose';

  const hasFolderOperations = useHasEmailFolderOperations();
  const { emails, loading, error, fetchEmails } = useEmails();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    ALL_MAIL_ID
  );
  const [selectedFolder, setSelectedFolder] = useState<EmailFolder | null>(
    null
  );
  const [folderRefreshToken, setFolderRefreshToken] = useState(0);
  const [activeTab, setActiveTab] = useState<MainTab>('inbox');
  const [isComposeTabOpen, setIsComposeTabOpen] = useState(false);
  const [composeOpenRequest, setComposeOpenRequest] =
    useState<ComposeOpenRequest | null>(null);

  const handleFolderChanged = useCallback(() => {
    setFolderRefreshToken((t) => t + 1);
  }, []);

  const closeComposeTab = useCallback(() => {
    setIsComposeTabOpen(false);
    setActiveTab('inbox');
  }, []);

  const handleCompose = useCallback(() => {
    setComposeOpenRequest(null);
    setIsComposeTabOpen(true);
    setActiveTab('compose');
  }, []);

  const handleFolderSelect = useCallback(
    (folderId: string | null, folder?: EmailFolder | null) => {
      setSelectedFolderId(folderId);
      setSelectedFolder(folder ?? null);
      setSelectedEmailId(null);
      setActiveTab('inbox');
    },
    []
  );

  const handleEmailSent = useCallback(() => {
    fetchEmails();
    closeComposeTab();
  }, [fetchEmails, closeComposeTab]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  useEffect(() => {
    if (!openComposeRequest) {
      return;
    }

    setComposeOpenRequest(openComposeRequest);
    setSelectedEmailId(null);
    setIsComposeTabOpen(true);
    setActiveTab('compose');
  }, [openComposeRequest]);

  const selectedEmail = emails.find((e) => e.id === selectedEmailId);
  const selectedFolderName = selectedFolder?.name ?? 'All Mail';
  const isListBackedFolder =
    selectedFolderId === ALL_MAIL_ID || selectedFolder?.folderType === 'inbox';

  return (
    <FloatingWindow
      id={id}
      title={
        selectedEmail
          ? 'Email'
          : activeTab === 'compose'
            ? 'New Message'
            : selectedFolderName
      }
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={550}
      defaultHeight={450}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <EmailWindowMenuBar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onRefresh={fetchEmails}
          onClose={onClose}
          onCompose={handleCompose}
        />
        <div className="flex flex-1 overflow-hidden">
          {hasFolderOperations && (
            <EmailFoldersSidebar
              width={sidebarWidth}
              onWidthChange={setSidebarWidth}
              selectedFolderId={selectedFolderId}
              onFolderSelect={handleFolderSelect}
              refreshToken={folderRefreshToken}
              onFolderChanged={handleFolderChanged}
            />
          )}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div
              role="tablist"
              aria-label="Email panel tabs"
              className="flex shrink-0 border-b bg-muted/20 px-2"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'inbox'}
                onClick={() => setActiveTab('inbox')}
                className="rounded-t-md px-3 py-2 text-sm hover:bg-muted/50 data-[active=true]:bg-background data-[active=true]:font-medium"
                data-active={activeTab === 'inbox'}
                data-testid="email-tab-inbox"
              >
                {selectedFolderName}
              </button>
              {isComposeTabOpen && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'compose'}
                  onClick={(e) => {
                    if (
                      e.target instanceof HTMLElement &&
                      e.target.closest('[data-close-tab="true"]')
                    ) {
                      closeComposeTab();
                      return;
                    }
                    setActiveTab('compose');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                      e.preventDefault();
                      closeComposeTab();
                    }
                  }}
                  className="group flex items-center gap-2 rounded-t-md py-2 pr-2 pl-3 text-sm hover:bg-muted/50 data-[active=true]:bg-background data-[active=true]:font-medium"
                  data-active={activeTab === 'compose'}
                  data-testid="email-tab-compose"
                >
                  New Message
                  <span
                    aria-hidden="true"
                    data-close-tab="true"
                    className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    data-testid="email-tab-compose-close"
                  >
                    <X className="h-3.5 w-3.5" />
                  </span>
                </button>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              {activeTab === 'compose' ? (
                <ComposeDialog
                  open
                  onOpenChange={closeComposeTab}
                  onEmailSent={handleEmailSent}
                  {...(composeOpenRequest && {
                    openRequest: composeOpenRequest
                  })}
                />
              ) : loading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <div className="p-4 text-destructive text-sm">{error}</div>
              ) : selectedEmailId && selectedEmail ? (
                <div className="flex h-full flex-col">
                  <div className="border-b p-3">
                    <button
                      type="button"
                      onClick={() => setSelectedEmailId(null)}
                      className="mb-2 text-muted-foreground text-xs hover:text-foreground"
                    >
                      &larr; Back to Inbox
                    </button>
                    <h2 className="font-medium text-sm">
                      {selectedEmail.subject || '(No Subject)'}
                    </h2>
                    <p className="text-muted-foreground text-xs">
                      From: {selectedEmail.from}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      To: {selectedEmail.to.join(', ')}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatEmailDate(selectedEmail.receivedAt)} ·{' '}
                      {formatEmailSize(selectedEmail.size)}
                    </p>
                  </div>
                  <div className="flex-1 overflow-auto p-3">
                    <p className="text-muted-foreground text-sm italic">
                      Email body parsing coming soon...
                    </p>
                  </div>
                </div>
              ) : !isListBackedFolder ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Mail className="h-8 w-8" />
                  <p className="text-sm">No emails in {selectedFolderName}</p>
                </div>
              ) : emails.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Mail className="h-8 w-8" />
                  <p className="text-sm">No emails yet</p>
                </div>
              ) : viewMode === 'list' ? (
                <div className="h-full overflow-auto">
                  {emails.map((email) => (
                    <button
                      key={email.id}
                      type="button"
                      onClick={() => setSelectedEmailId(email.id)}
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
              ) : (
                <div className="h-full overflow-auto">
                  <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
                    <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
                      <tr>
                        <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                          Subject
                        </th>
                        <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                          From
                        </th>
                        <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                          Date
                        </th>
                        <th
                          className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} text-right`}
                        >
                          Size
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {emails.map((email) => (
                        <WindowTableRow
                          key={email.id}
                          onClick={() => setSelectedEmailId(email.id)}
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
                          <td
                            className={`${WINDOW_TABLE_TYPOGRAPHY.mutedCell} text-right`}
                          >
                            {formatEmailSize(email.size)}
                          </td>
                        </WindowTableRow>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}
