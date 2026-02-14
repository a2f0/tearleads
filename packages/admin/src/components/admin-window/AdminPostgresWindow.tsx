import type { WindowDimensions } from '@tearleads/window-manager';
import { AdminWindow } from './AdminWindow';

interface AdminPostgresWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function AdminPostgresWindow(props: AdminPostgresWindowProps) {
  return <AdminWindow {...props} initialView="postgres" />;
}
