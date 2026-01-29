import { VfsWindow as VfsWindowBase } from '@rapid/vfs-explorer';
import type { WindowDimensions } from '@rapid/window-manager';
import { ClientVfsExplorerProvider } from '@/contexts/ClientVfsExplorerProvider';

interface VfsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

/**
 * VfsWindow wrapped with ClientVfsExplorerProvider.
 * This provides all the dependencies (database, UI components, VFS keys, auth)
 * required by the @rapid/vfs-explorer package.
 */
export function VfsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: VfsWindowProps) {
  return (
    <ClientVfsExplorerProvider>
      <VfsWindowBase
        id={id}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onFocus={onFocus}
        zIndex={zIndex}
        initialDimensions={initialDimensions}
      />
    </ClientVfsExplorerProvider>
  );
}
