import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Debug } from '@/pages/debug';
import { DebugWindowMenuBar } from './DebugWindowMenuBar';

interface DebugWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function DebugWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: DebugWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Debug"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={520}
      defaultHeight={560}
      minWidth={420}
      minHeight={360}
    >
      <div className="flex h-full flex-col">
        <DebugWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-y-auto p-4">
          <Debug showTitle={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
