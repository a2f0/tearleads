import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Analytics } from '@/pages/analytics';
import { AnalyticsWindowMenuBar } from './AnalyticsWindowMenuBar';

interface AnalyticsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AnalyticsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
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
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={400}
      minHeight={350}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <AnalyticsWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-hidden p-4">
          <Analytics showBackLink={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
