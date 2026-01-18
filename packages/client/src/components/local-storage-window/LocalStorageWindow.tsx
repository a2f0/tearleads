import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { LocalStorage } from '@/pages/local-storage';
import { LocalStorageWindowMenuBar } from './LocalStorageWindowMenuBar';

interface LocalStorageWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function LocalStorageWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: LocalStorageWindowProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Local Storage"
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
        <LocalStorageWindowMenuBar
          onRefresh={handleRefresh}
          onClose={onClose}
        />
        <div className="flex-1 overflow-auto p-4" key={refreshKey}>
          <LocalStorage />
        </div>
      </div>
    </FloatingWindow>
  );
}
