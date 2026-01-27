import { useState } from 'react';
import { VfsDetailsPanel } from './VfsDetailsPanel';
import { VfsTreePanel } from './VfsTreePanel';

export type VfsViewMode = 'list' | 'table';

interface VfsExplorerProps {
  className?: string;
  compact?: boolean | undefined;
  viewMode?: VfsViewMode | undefined;
  refreshToken?: number | undefined;
}

export function VfsExplorer({
  className,
  compact,
  viewMode = 'list',
  refreshToken: _refreshToken
}: VfsExplorerProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [treePanelWidth, setTreePanelWidth] = useState(240);

  return (
    <div className={`flex h-full ${className ?? ''}`}>
      <VfsTreePanel
        width={treePanelWidth}
        onWidthChange={setTreePanelWidth}
        selectedFolderId={selectedFolderId}
        onFolderSelect={setSelectedFolderId}
        compact={compact}
      />
      <VfsDetailsPanel
        folderId={selectedFolderId}
        viewMode={viewMode}
        compact={compact}
      />
    </div>
  );
}
