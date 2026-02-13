import { WindowControlBar } from '@tearleads/window-manager';
import { BusinessesManager } from '@/components/businesses';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';

const BUSINESSES_WINDOW_DEFAULT_WIDTH = 860;
const BUSINESSES_WINDOW_DEFAULT_HEIGHT = 560;
const BUSINESSES_WINDOW_MIN_WIDTH = 620;
const BUSINESSES_WINDOW_MIN_HEIGHT = 420;

interface BusinessesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function BusinessesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: BusinessesWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Businesses"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={BUSINESSES_WINDOW_DEFAULT_WIDTH}
      defaultHeight={BUSINESSES_WINDOW_DEFAULT_HEIGHT}
      minWidth={BUSINESSES_WINDOW_MIN_WIDTH}
      minHeight={BUSINESSES_WINDOW_MIN_HEIGHT}
    >
      <div className="flex h-full min-h-0 flex-col">
        <WindowControlBar>{null}</WindowControlBar>
        <div className="min-h-0 flex-1 p-3">
          <BusinessesManager />
        </div>
      </div>
    </FloatingWindow>
  );
}
