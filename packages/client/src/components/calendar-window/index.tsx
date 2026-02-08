import { CalendarWindow as CalendarWindowBase } from '@rapid/calendar';
import type { WindowDimensions } from '@rapid/window-manager';

interface CalendarWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
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
    <CalendarWindowBase
      id={id}
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(onDimensionsChange && { onDimensionsChange })}
      {...(initialDimensions && { initialDimensions })}
    />
  );
}
