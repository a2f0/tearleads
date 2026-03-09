import {
  FloatingWindow,
  useWindowRefresh,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Health, type HealthDrilldownRoute } from '../../pages/Health';
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
  const { refreshToken, triggerRefresh } = useWindowRefresh();
  const [activeRoute, setActiveRoute] = useState<
    HealthDrilldownRoute | undefined
  >(undefined);

  const handleRefresh = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  const handleRouteChange = useCallback(
    (route: HealthDrilldownRoute | undefined) => {
      setActiveRoute(route);
    },
    []
  );

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
        <HealthWindowMenuBar
          activeRoute={activeRoute}
          onRouteChange={handleRouteChange}
          onRefresh={handleRefresh}
          onClose={onClose}
        />
        <WindowControlBar>
          <WindowControlGroup>
            {activeRoute !== undefined && (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={() => handleRouteChange(undefined)}
                data-testid="health-window-control-back"
              >
                Back
              </WindowControlButton>
            )}
            <WindowControlButton
              icon={<RefreshCw className="h-3 w-3" />}
              onClick={handleRefresh}
              data-testid="health-window-control-refresh"
            >
              Refresh
            </WindowControlButton>
          </WindowControlGroup>
        </WindowControlBar>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <Health
            showBackLink={false}
            refreshToken={refreshToken}
            activeRoute={activeRoute}
            onRouteChange={handleRouteChange}
          />
        </div>
      </div>
    </FloatingWindow>
  );
}
