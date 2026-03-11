import {
  FloatingWindow,
  type WindowDimensions
} from '@tearleads/window-manager';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  useEmailDatabaseState,
  useHasEmailFolderOperations
} from '../context/EmailContext.js';
import { useDrafts, useEmailBody, useEmails } from '../hooks';
import { useComposeTab } from '../hooks/useComposeTab.js';
import { ALL_MAIL_ID, type EmailFolder } from '../types/folder.js';
import type { ComposeOpenRequest } from './EmailWindowContent.js';
import { EmailWindowContent } from './EmailWindowContent.js';
import { EmailWindowControlBar } from './EmailWindowControlBar.js';
import type { ViewMode } from './EmailWindowMenuBar';
import { EmailWindowMenuBar } from './EmailWindowMenuBar';
import { EmailWindowTabBar } from './EmailWindowTabBar.js';
import { EmailFoldersSidebar } from './sidebar/EmailFoldersSidebar.js';

const DEFAULT_SIDEBAR_WIDTH = 180;

interface EmailWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  openComposeRequest?: ComposeOpenRequest;
  openEmailId?: string | null | undefined;
  openRequestId?: number | undefined;
  isUnlocked?: boolean;
  isDatabaseLoading?: boolean;
  lockedFallback?: ReactNode;
}

export function EmailWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  openComposeRequest,
  openEmailId,
  openRequestId,
  isUnlocked,
  isDatabaseLoading,
  lockedFallback
}: EmailWindowProps) {
  const databaseState = useEmailDatabaseState();
  const hasFolderOperations = useHasEmailFolderOperations();
  const { emails, loading, error, fetchEmails } = useEmails();
  const resolvedIsUnlocked = isUnlocked ?? databaseState.isUnlocked;
  const resolvedIsDatabaseLoading =
    isDatabaseLoading ?? databaseState.isLoading;
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

  const { body: emailBody } = useEmailBody(selectedEmailId);
  const { drafts, loading: draftsLoading, fetchDrafts } = useDrafts();
  const selectedEmail = emails.find((e) => e.id === selectedEmailId);
  const isDraftsFolder = selectedFolder?.folderType === 'drafts';

  const {
    activeTab,
    setActiveTab,
    isComposeTabOpen,
    composeOpenRequest: resolvedComposeRequest,
    composeLabel,
    closeComposeTab,
    handleCompose,
    openComposeForMode,
    handleComposeForEmail,
    handleEmailSent
  } = useComposeTab({
    selectedEmail,
    emailBodyText: emailBody?.text ?? '',
    openComposeRequest,
    openEmailId,
    openRequestId,
    fetchEmails,
    setSelectedEmailId
  });

  const handleFolderChanged = useCallback(() => {
    setFolderRefreshToken((t) => t + 1);
  }, []);

  const handleFolderSelect = useCallback(
    (folderId: string | null, folder?: EmailFolder | null) => {
      setSelectedFolderId(folderId);
      setSelectedFolder(folder ?? null);
      setSelectedEmailId(null);
      setActiveTab('inbox');
    },
    [setActiveTab]
  );

  const handleBackToInbox = useCallback(() => {
    setSelectedEmailId(null);
    setActiveTab('inbox');
  }, [setActiveTab]);

  useEffect(() => {
    if (!resolvedIsUnlocked) return;
    fetchEmails();
  }, [fetchEmails, resolvedIsUnlocked]);

  useEffect(() => {
    if (!resolvedIsUnlocked || !isDraftsFolder) return;
    fetchDrafts();
  }, [fetchDrafts, resolvedIsUnlocked, isDraftsFolder]);

  const selectedFolderName = selectedFolder?.name ?? 'All Mail';
  const isListBackedFolder =
    selectedFolderId === ALL_MAIL_ID ||
    selectedFolder?.folderType === 'inbox' ||
    isDraftsFolder;

  return (
    <FloatingWindow
      id={id}
      title={
        selectedEmail
          ? 'Email'
          : activeTab === 'compose'
            ? composeLabel
            : selectedFolderName
      }
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
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
        {resolvedIsUnlocked && (
          <EmailWindowControlBar
            selectedEmailId={selectedEmailId}
            activeTab={activeTab}
            onBack={handleBackToInbox}
            onCloseCompose={closeComposeTab}
            onCompose={handleCompose}
            onRefresh={fetchEmails}
            onComposeForMode={openComposeForMode}
          />
        )}
        <div className="flex flex-1 overflow-hidden">
          {resolvedIsUnlocked && hasFolderOperations && (
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
            {resolvedIsUnlocked && (
              <EmailWindowTabBar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                selectedFolderName={selectedFolderName}
                isComposeTabOpen={isComposeTabOpen}
                onCloseCompose={closeComposeTab}
                composeLabel={composeLabel}
              />
            )}
            <div className="flex-1 overflow-hidden">
              <EmailWindowContent
                isDatabaseLoading={resolvedIsDatabaseLoading}
                isUnlocked={resolvedIsUnlocked}
                lockedFallback={lockedFallback}
                activeTab={activeTab}
                onCloseCompose={closeComposeTab}
                onEmailSent={handleEmailSent}
                composeOpenRequest={resolvedComposeRequest}
                loading={loading}
                error={error}
                selectedEmailId={selectedEmailId}
                selectedEmail={selectedEmail}
                isListBackedFolder={isListBackedFolder}
                isDraftsFolder={isDraftsFolder}
                selectedFolderName={selectedFolderName}
                emails={emails}
                drafts={drafts}
                draftsLoading={draftsLoading}
                onSelectEmail={setSelectedEmailId}
                viewMode={viewMode}
                onComposeForEmail={handleComposeForEmail}
              />
            </div>
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}
