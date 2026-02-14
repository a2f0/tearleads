import { WindowControlBar } from '@tearleads/window-manager';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Health } from '@/pages/Health';

const HEALTH_WINDOW_DEFAULT_WIDTH = 760;
const HEALTH_WINDOW_DEFAULT_HEIGHT = 560;
const HEALTH_WINDOW_MIN_WIDTH = 560;
const HEALTH_WINDOW_MIN_HEIGHT = 420;

interface HealthWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function HealthWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: HealthWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Health"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={HEALTH_WINDOW_DEFAULT_WIDTH}
      defaultHeight={HEALTH_WINDOW_DEFAULT_HEIGHT}
      minWidth={HEALTH_WINDOW_MIN_WIDTH}
      minHeight={HEALTH_WINDOW_MIN_HEIGHT}
    >
      <div className="flex h-full min-h-0 flex-col">
        <WindowControlBar>{null}</WindowControlBar>
        <div className="min-h-0 flex-1 p-3">
          <Health showBackLink={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
