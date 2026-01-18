import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { AudioWindowList } from './AudioWindowList';
import type { AudioViewMode } from './AudioWindowMenuBar';
import { AudioWindowMenuBar } from './AudioWindowMenuBar';
import { AudioWindowTableView } from './AudioWindowTableView';

interface AudioWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AudioWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AudioWindowProps) {
  const [view, setView] = useState<AudioViewMode>('list');

  return (
    <FloatingWindow
      id={id}
      title="Audio"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={450}
      defaultHeight={500}
      minWidth={350}
      minHeight={350}
    >
      <div className="flex h-full flex-col">
        <AudioWindowMenuBar
          onClose={onClose}
          view={view}
          onViewChange={setView}
        />
        <div className="flex-1 overflow-hidden">
          {view === 'list' ? <AudioWindowList /> : <AudioWindowTableView />}
        </div>
      </div>
    </FloatingWindow>
  );
}
