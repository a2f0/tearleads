import { WindowControlBar } from '@tearleads/window-manager';
import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Health } from '@/pages/Health';
import { HealthWindowMenuBar } from './HealthWindowMenuBar';

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
  const [refreshToken, setRefreshToken] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

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
        <WindowControlBar>
          <HealthWindowMenuBar onRefresh={handleRefresh} onClose={onClose} />
        </WindowControlBar>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <Health showBackLink={false} refreshToken={refreshToken} />
        </div>
      </div>
    </FloatingWindow>
  );
}
