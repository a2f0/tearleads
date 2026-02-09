import { Loader2, Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { EmailFoldersSidebar } from '../components/sidebar/EmailFoldersSidebar.js';
import { useEmailUI, useHasEmailFolderOperations } from '../context';
import { useEmails } from '../hooks';
import { formatEmailDate, formatEmailSize } from '../lib';
import { ALL_MAIL_ID, type EmailFolder } from '../types/folder.js';

const DEFAULT_SIDEBAR_WIDTH = 200;

export function Email() {
  const { BackLink, RefreshButton } = useEmailUI();
  const hasFolderOperations = useHasEmailFolderOperations();
  const { emails, loading, error, fetchEmails } = useEmails();
  const [hasFetched, setHasFetched] = useState(false);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    ALL_MAIL_ID
  );
  const [selectedFolder, setSelectedFolder] = useState<EmailFolder | null>(
    null
  );
  const [folderRefreshToken, setFolderRefreshToken] = useState(0);

  const handleFolderChanged = useCallback(() => {
    setFolderRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!hasFetched) {
      setHasFetched(true);
      fetchEmails();
    }
  }, [hasFetched, fetchEmails]);

  const handleFolderSelect = useCallback(
    (folderId: string | null, folder?: EmailFolder | null) => {
      setSelectedFolderId(folderId);
      setSelectedFolder(folder ?? null);
      setSelectedEmailId(null);
    },
    []
  );

  const selectedEmail = emails.find((email) => email.id === selectedEmailId);
  const selectedFolderName = selectedFolder?.name ?? 'All Mail';
  const isListBackedFolder =
    selectedFolderId === ALL_MAIL_ID || selectedFolder?.folderType === 'inbox';

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Email</h1>
          </div>
          <RefreshButton onClick={fetchEmails} loading={loading} />
        </div>
      </div>

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
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
        <div className="flex-1 overflow-hidden">
          {loading && emails.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading emails...
            </div>
          ) : !isListBackedFolder ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Mail className="h-12 w-12" />
              <p>No emails in {selectedFolderName}</p>
            </div>
          ) : emails.length === 0 && hasFetched && !error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Mail className="h-12 w-12" />
              <p>No emails yet</p>
              <p className="text-center text-xs">
                Send an email to your configured address to see it here
              </p>
            </div>
          ) : selectedEmail ? (
            <div className="flex h-full flex-col">
              <div className="border-b p-4">
                <button
                  type="button"
                  onClick={() => setSelectedEmailId(null)}
                  className="mb-2 text-muted-foreground text-xs hover:text-foreground"
                >
                  &larr; Back to Email
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
              <div className="flex-1 overflow-auto p-4">
                <p className="text-muted-foreground text-sm italic">
                  Email body parsing coming soon...
                </p>
              </div>
            </div>
          ) : (
            <div className="h-full overflow-auto" data-testid="email-list">
              {emails.map((email) => (
                <button
                  key={email.id}
                  type="button"
                  onClick={() => setSelectedEmailId(email.id)}
                  className="flex w-full items-start gap-3 border-b p-4 text-left transition-colors last:border-b-0 hover:bg-muted/50"
                >
                  <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {email.subject || '(No Subject)'}
                    </p>
                    <p className="truncate text-muted-foreground text-sm">
                      From: {email.from}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatEmailDate(email.receivedAt)} ·{' '}
                      {formatEmailSize(email.size)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
