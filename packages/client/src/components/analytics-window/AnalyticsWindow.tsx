import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Analytics } from '@/pages/analytics';

interface AnalyticsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function AnalyticsWindow({
  id,
  onClose,
  onMinimize,
  onFocus,
  zIndex,
  initialDimensions
}: AnalyticsWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Analytics"
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={400}
      minHeight={350}
    >
      <div className="flex h-full flex-col overflow-hidden p-4">
        <Analytics />
      </div>
    </FloatingWindow>
  );
}
