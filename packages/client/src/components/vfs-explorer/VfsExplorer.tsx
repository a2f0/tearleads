import { useCallback, useState } from 'react';
import { VfsDetailsPanel } from './VfsDetailsPanel';
import { VfsTreePanel } from './VfsTreePanel';

export type VfsViewMode = 'list' | 'table';

interface VfsExplorerProps {
  className?: string;
  compact?: boolean | undefined;
  viewMode?: VfsViewMode | undefined;
  refreshToken?: number | undefined;
  selectedFolderId?: string | null | undefined;
  onFolderSelect?: ((folderId: string | null) => void) | undefined;
}

export function VfsExplorer({
  className,
  compact,
  viewMode = 'list',
  refreshToken: _refreshToken,
  selectedFolderId: controlledSelectedFolderId,
  onFolderSelect
}: VfsExplorerProps) {
  const [internalSelectedFolderId, setInternalSelectedFolderId] = useState<
    string | null
  >(null);
  const [treePanelWidth, setTreePanelWidth] = useState(240);

  // Use controlled state if provided, otherwise use internal state
  const selectedFolderId =
    controlledSelectedFolderId !== undefined
      ? controlledSelectedFolderId
      : internalSelectedFolderId;

  const handleFolderSelect = useCallback(
    (folderId: string | null) => {
      if (onFolderSelect) {
        onFolderSelect(folderId);
      } else {
        setInternalSelectedFolderId(folderId);
      }
    },
    [onFolderSelect]
  );

  return (
    <div className={`flex h-full ${className ?? ''}`}>
      <VfsTreePanel
        width={treePanelWidth}
        onWidthChange={setTreePanelWidth}
        selectedFolderId={selectedFolderId}
        onFolderSelect={handleFolderSelect}
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
