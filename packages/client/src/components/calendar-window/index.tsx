import { CalendarContent } from '@rapid/calendar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { CalendarWindowMenuBar } from './CalendarWindowMenuBar';

const CALENDAR_WINDOW_DEFAULT_WIDTH = 900;
const CALENDAR_WINDOW_DEFAULT_HEIGHT = 640;
const CALENDAR_WINDOW_MIN_WIDTH = 680;
const CALENDAR_WINDOW_MIN_HEIGHT = 420;

interface CalendarWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function CalendarWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: CalendarWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Calendar"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={CALENDAR_WINDOW_DEFAULT_WIDTH}
      defaultHeight={CALENDAR_WINDOW_DEFAULT_HEIGHT}
      minWidth={CALENDAR_WINDOW_MIN_WIDTH}
      minHeight={CALENDAR_WINDOW_MIN_HEIGHT}
    >
      <div className="flex h-full flex-col">
        <CalendarWindowMenuBar onClose={onClose} />
        <CalendarContent />
      </div>
    </FloatingWindow>
  );
}
