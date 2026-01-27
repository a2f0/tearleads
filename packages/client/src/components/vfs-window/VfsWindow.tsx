import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { VfsExplorer } from '@/components/vfs-explorer';
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
}

export function VfsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: VfsWindowProps) {
  const [viewMode, setViewMode] = useState<VfsViewMode>('list');
  const [refreshToken, setRefreshToken] = useState(0);

  const handleNewFolder = useCallback(() => {
    // TODO: Open new folder dialog
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
          <VfsExplorer viewMode={viewMode} refreshToken={refreshToken} />
        </div>
      </div>
    </FloatingWindow>
  );
}
