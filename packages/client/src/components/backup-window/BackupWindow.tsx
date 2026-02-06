import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
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
        <BackupWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-y-auto p-4">
          <BackupManagerView />
        </div>
      </div>
    </FloatingWindow>
  );
}
