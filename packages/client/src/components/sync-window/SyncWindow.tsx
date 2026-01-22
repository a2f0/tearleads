import { MemoryRouter } from 'react-router-dom';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Sync } from '@/pages/Sync';
import { SyncWindowMenuBar } from './SyncWindowMenuBar';

interface SyncWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function SyncWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
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
      <div className="flex h-full flex-col">
        <SyncWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-auto p-3">
          <MemoryRouter initialEntries={['/sync']}>
            <Sync showBackLink={false} />
          </MemoryRouter>
        </div>
      </div>
    </FloatingWindow>
  );
}
