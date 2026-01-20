import { useCallback, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { CacheStorage } from '@/pages/cache-storage';
import { CacheStorageWindowMenuBar } from './CacheStorageWindowMenuBar';

interface CacheStorageWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function CacheStorageWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: CacheStorageWindowProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Cache Storage"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      initialDimensions={initialDimensions}
      defaultWidth={650}
      defaultHeight={500}
      minWidth={400}
      minHeight={350}
    >
      <div className="flex h-full flex-col">
        <CacheStorageWindowMenuBar
          onRefresh={handleRefresh}
          onClose={onClose}
        />
        <div className="flex-1 overflow-auto p-4" key={refreshKey}>
          <MemoryRouter initialEntries={['/cache-storage']}>
            <CacheStorage />
          </MemoryRouter>
        </div>
      </div>
    </FloatingWindow>
  );
}
