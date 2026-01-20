import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { cn } from '@/lib/utils';
import { Settings } from '@/pages/Settings';
import { SettingsWindowMenuBar } from './SettingsWindowMenuBar';

interface SettingsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function SettingsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: SettingsWindowProps) {
  const [compact, setCompact] = useState(false);

  return (
    <FloatingWindow
      id={id}
      title="Settings"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      fitContent
      defaultWidth={500}
      defaultHeight={600}
      minWidth={400}
      minHeight={400}
      maxWidthPercent={1}
      maxHeightPercent={1}
    >
      <div className="flex h-full flex-col">
        <SettingsWindowMenuBar
          compact={compact}
          onCompactChange={setCompact}
          onClose={onClose}
        />
        <div className={cn('flex-1 overflow-auto', compact ? 'p-3' : 'p-6')}>
          <MemoryRouter initialEntries={['/settings']}>
            <Settings />
          </MemoryRouter>
        </div>
      </div>
    </FloatingWindow>
  );
}
