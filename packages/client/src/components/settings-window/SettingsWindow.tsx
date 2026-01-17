import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Settings } from '@/pages/Settings';

interface SettingsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function SettingsWindow({
  id,
  onClose,
  onMinimize,
  onFocus,
  zIndex,
  initialDimensions
}: SettingsWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Settings"
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={500}
      defaultHeight={600}
      minWidth={400}
      minHeight={400}
    >
      <div className="h-full overflow-auto p-6">
        <Settings />
      </div>
    </FloatingWindow>
  );
}
