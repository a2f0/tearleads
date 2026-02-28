import { WindowControlBar } from '@tearleads/window-manager';
import { useCallback, useState } from 'react';
import { SHARED_BY_ME_FOLDER_ID, SHARED_WITH_ME_FOLDER_ID } from '../constants';
import { useVfsExplorerContext, type WindowDimensions } from '../context';
import { NewFolderDialog } from './NewFolderDialog';
import { VfsExplorer, type VfsOpenItem } from './VfsExplorer';
import type { VfsViewMode } from './VfsWindowMenuBar';
import { VfsWindowMenuBar } from './VfsWindowMenuBar';

interface VfsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  onItemOpen?: ((item: VfsOpenItem) => void) | undefined;
  onUpload?: ((folderId: string) => void) | undefined;
  refreshToken?: number | undefined;
}

export function VfsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  onItemOpen,
  onUpload,
  refreshToken: externalRefreshToken
}: VfsWindowProps) {
  const {
    ui: { FloatingWindow },
    syncRemoteState
  } = useVfsExplorerContext();
  const [viewMode, setViewMode] = useState<VfsViewMode>('table');
  const [internalRefreshToken, setInternalRefreshToken] = useState(0);
  const refreshToken = internalRefreshToken + (externalRefreshToken ?? 0);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const handleNewFolder = useCallback(() => {
    setShowNewFolderDialog(true);
  }, []);

  const handleFolderCreated = useCallback((_id: string, _name: string) => {
    // Refresh the folder list
    setInternalRefreshToken((t) => t + 1);
  }, []);

  const handleLinkItem = useCallback(() => {
    // TODO: Open link item dialog
  }, []);

  const handleRefresh = useCallback(async () => {
    const shouldSyncRemoteState =
      selectedFolderId === SHARED_BY_ME_FOLDER_ID ||
      selectedFolderId === SHARED_WITH_ME_FOLDER_ID;

    if (shouldSyncRemoteState && syncRemoteState) {
      try {
        await syncRemoteState();
      } catch (err) {
        console.error('Failed to sync shared VFS listings:', err);
      }
    }
    setInternalRefreshToken((t) => t + 1);
  }, [selectedFolderId, syncRemoteState]);

  return (
    <FloatingWindow
      id={id}
      title="VFS Explorer"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={900}
      defaultHeight={600}
      minWidth={600}
      minHeight={400}
    >
      <div className="flex h-full flex-col">
        <VfsWindowMenuBar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onNewFolder={handleNewFolder}
          onLinkItem={handleLinkItem}
          onRefresh={handleRefresh}
          onClose={onClose}
        />
        <WindowControlBar>{null}</WindowControlBar>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <VfsExplorer
            viewMode={viewMode}
            refreshToken={refreshToken}
            selectedFolderId={selectedFolderId}
            onFolderSelect={setSelectedFolderId}
            onItemOpen={onItemOpen}
            onUpload={onUpload}
          />
        </div>
      </div>
      <NewFolderDialog
        open={showNewFolderDialog}
        onOpenChange={setShowNewFolderDialog}
        parentFolderId={selectedFolderId}
        onFolderCreated={handleFolderCreated}
      />
    </FloatingWindow>
  );
}
