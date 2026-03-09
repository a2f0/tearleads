import { Mail } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { EmailFoldersSidebar } from '../components/sidebar/EmailFoldersSidebar.js';
import {
  useEmailDatabaseState,
  useEmailUI,
  useHasEmailFolderOperations
} from '../context';
import { useEmails } from '../hooks';
import { ALL_MAIL_ID, type EmailFolder } from '../types/folder.js';
import { EmailContentPanel } from './EmailContentPanel.js';

const DEFAULT_SIDEBAR_WIDTH = 200;

interface EmailProps {
  lockedFallback?: ReactNode;
}

export function Email({ lockedFallback }: EmailProps = {}) {
  const databaseState = useEmailDatabaseState();
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
    if (!databaseState.isUnlocked) {
      return;
    }
    if (!hasFetched) {
      setHasFetched(true);
      fetchEmails();
    }
  }, [databaseState.isUnlocked, fetchEmails, hasFetched]);

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

  if (databaseState.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading database...
      </div>
    );
  }

  if (!databaseState.isUnlocked) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        {lockedFallback}
      </div>
    );
  }

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
          <EmailContentPanel
            loading={loading}
            error={error}
            emails={emails}
            hasFetched={hasFetched}
            isListBackedFolder={isListBackedFolder}
            selectedFolderName={selectedFolderName}
            selectedEmail={selectedEmail}
            onSelectEmail={setSelectedEmailId}
          />
        </div>
      </div>
    </div>
  );
}
