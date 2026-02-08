import { ClassicApp } from '@rapid/classic';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { CLASSIC_INITIAL_STATE } from '@/lib/classicState';

interface ClassicWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function ClassicWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: ClassicWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Classic"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={980}
      defaultHeight={700}
      minWidth={620}
      minHeight={420}
    >
      <div className="h-full p-3">
        <ClassicApp initialState={CLASSIC_INITIAL_STATE} />
      </div>
    </FloatingWindow>
  );
}
