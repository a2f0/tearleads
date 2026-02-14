import { WindowControlBar } from '@tearleads/window-manager';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Vehicles } from '@/pages/Vehicles';

const VEHICLES_WINDOW_DEFAULT_WIDTH = 900;
const VEHICLES_WINDOW_DEFAULT_HEIGHT = 620;
const VEHICLES_WINDOW_MIN_WIDTH = 680;
const VEHICLES_WINDOW_MIN_HEIGHT = 420;

interface VehiclesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function VehiclesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: VehiclesWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Vehicles"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={VEHICLES_WINDOW_DEFAULT_WIDTH}
      defaultHeight={VEHICLES_WINDOW_DEFAULT_HEIGHT}
      minWidth={VEHICLES_WINDOW_MIN_WIDTH}
      minHeight={VEHICLES_WINDOW_MIN_HEIGHT}
    >
      <div className="flex h-full min-h-0 flex-col">
        <WindowControlBar>{null}</WindowControlBar>
        <div className="min-h-0 flex-1 p-3">
          <Vehicles showBackLink={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
