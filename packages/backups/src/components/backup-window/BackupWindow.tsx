import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  type WindowDimensions
} from '@tearleads/window-manager';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { BackupDocumentation } from './BackupDocumentation';
import { BackupManagerView } from './BackupManagerView';
import { BackupWindowMenuBar } from './BackupWindowMenuBar';

interface BackupWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  databaseBlocker?: ReactNode;
}

export function BackupWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  databaseBlocker
}: BackupWindowProps) {
  const [showDocumentation, setShowDocumentation] = useState(false);

  return (
    <FloatingWindow
      id={id}
      title="Backup Manager"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
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
        <WindowControlBar>{null}</WindowControlBar>
        <div className="flex-1 overflow-y-auto p-4">
          {databaseBlocker ? (
            databaseBlocker
          ) : showDocumentation ? (
            <BackupDocumentation onBack={() => setShowDocumentation(false)} />
          ) : (
            <BackupManagerView />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
