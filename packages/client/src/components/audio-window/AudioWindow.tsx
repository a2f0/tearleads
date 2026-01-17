import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { AudioWindowList } from './AudioWindowList';
import { AudioWindowMenuBar } from './AudioWindowMenuBar';

interface AudioWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function AudioWindow({
  id,
  onClose,
  onMinimize,
  onFocus,
  zIndex,
  initialDimensions
}: AudioWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Audio"
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={450}
      defaultHeight={500}
      minWidth={350}
      minHeight={350}
    >
      <div className="flex h-full flex-col">
        <AudioWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-hidden">
          <AudioWindowList />
        </div>
      </div>
    </FloatingWindow>
  );
}
