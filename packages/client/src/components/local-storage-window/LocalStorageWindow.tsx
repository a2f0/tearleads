import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import { useCallback, useState } from 'react';
import { LocalStorage } from '@/pages/localStorage';
import { LocalStorageWindowMenuBar } from './LocalStorageWindowMenuBar';

interface LocalStorageWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function LocalStorageWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
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
      onRename={onRename}
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
        <WindowControlBar>{null}</WindowControlBar>
        <div className="flex-1 overflow-auto p-4" key={refreshKey}>
          <LocalStorage showBackLink={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
