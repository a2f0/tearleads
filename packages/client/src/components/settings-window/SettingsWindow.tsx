import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { cn } from '@/lib/utils';
import { Settings } from '@/pages/Settings';
import { SettingsWindowMenuBar } from './SettingsWindowMenuBar';

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
  const [compact, setCompact] = useState(false);

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
      <div className="flex h-full flex-col">
        <SettingsWindowMenuBar
          compact={compact}
          onCompactChange={setCompact}
          onClose={onClose}
        />
        <div className={cn('flex-1 overflow-auto', compact ? 'p-3' : 'p-6')}>
          <Settings />
        </div>
      </div>
    </FloatingWindow>
  );
}
