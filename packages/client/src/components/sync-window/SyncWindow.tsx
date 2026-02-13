import { WindowControlBar } from '@tearleads/window-manager';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Sync } from '@/pages/Sync';
import { SyncWindowMenuBar } from './SyncWindowMenuBar';

interface SyncWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function SyncWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: SyncWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Sync"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      fitContent
      defaultWidth={400}
      defaultHeight={450}
      minWidth={350}
      minHeight={350}
      maxWidthPercent={1}
      maxHeightPercent={1}
    >
      <div className="flex h-full min-h-0 flex-col">
        <SyncWindowMenuBar onClose={onClose} />
        <WindowControlBar>{null}</WindowControlBar>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <Sync showBackLink={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
