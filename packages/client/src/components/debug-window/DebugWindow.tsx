import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import { Debug } from '@/pages/debug';
import { DebugWindowMenuBar } from './DebugWindowMenuBar';

interface DebugWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function DebugWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
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
      onRename={onRename}
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
        <WindowControlBar>{null}</WindowControlBar>
        <div className="flex-1 overflow-y-auto p-6">
          <Debug showTitle={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
