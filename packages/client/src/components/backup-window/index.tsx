import { BackupWindow as BackupWindowBase } from '@tearleads/backups';
import type { WindowDimensions } from '@tearleads/window-manager';

interface BackupWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: (title: string) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function BackupWindow(props: BackupWindowProps) {
  return <BackupWindowBase {...props} />;
}
