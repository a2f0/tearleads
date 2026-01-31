import { useCallback, useState } from 'react';
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
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  onItemOpen?: ((item: VfsOpenItem) => void) | undefined;
}

export function VfsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions,
  onItemOpen
}: VfsWindowProps) {
  const {
    ui: { FloatingWindow }
  } = useVfsExplorerContext();
  const [viewMode, setViewMode] = useState<VfsViewMode>('table');
  const [refreshToken, setRefreshToken] = useState(0);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const handleNewFolder = useCallback(() => {
    setShowNewFolderDialog(true);
  }, []);

  const handleFolderCreated = useCallback((_id: string, _name: string) => {
    // Refresh the folder list
    setRefreshToken((t) => t + 1);
  }, []);

  const handleLinkItem = useCallback(() => {
    // TODO: Open link item dialog
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshToken((t) => t + 1);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="VFS Explorer"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
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
        <div className="flex-1 overflow-hidden">
          <VfsExplorer
            viewMode={viewMode}
            refreshToken={refreshToken}
            selectedFolderId={selectedFolderId}
            onFolderSelect={setSelectedFolderId}
            onItemOpen={onItemOpen}
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
