import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { BackupDocumentation } from './BackupDocumentation';
import { BackupManagerView } from './BackupManagerView';
import { BackupWindowMenuBar } from './BackupWindowMenuBar';

interface BackupWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function BackupWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: BackupWindowProps) {
  const [showDocumentation, setShowDocumentation] = useState(false);

  return (
    <FloatingWindow
      id={id}
      title="Backup Manager"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={520}
      defaultHeight={560}
      minWidth={400}
      minHeight={400}
    >
      <div className="flex h-full flex-col">
        <BackupWindowMenuBar
          onClose={onClose}
          onOpenDocumentation={() => setShowDocumentation(true)}
        />
        <div className="flex-1 overflow-y-auto p-4">
          {showDocumentation ? (
            <BackupDocumentation onBack={() => setShowDocumentation(false)} />
          ) : (
            <BackupManagerView />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
