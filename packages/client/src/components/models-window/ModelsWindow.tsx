import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { ModelsContent } from '@/pages/models/ModelsContent';
import type { ViewMode } from './ModelsWindowMenuBar';
import { ModelsWindowMenuBar } from './ModelsWindowMenuBar';

interface ModelsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function ModelsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: ModelsWindowProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('cards');

  return (
    <FloatingWindow
      id={id}
      title="Models"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={720}
      defaultHeight={600}
      minWidth={420}
      minHeight={320}
    >
      <div className="flex h-full flex-col">
        <ModelsWindowMenuBar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onClose={onClose}
        />
        <div className="flex-1 overflow-y-auto p-4">
          <ModelsContent showBackLink={false} viewMode={viewMode} />
        </div>
      </div>
    </FloatingWindow>
  );
}
