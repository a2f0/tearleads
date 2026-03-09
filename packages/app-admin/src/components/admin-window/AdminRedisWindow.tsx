import type { WindowDimensions } from '@tearleads/window-manager';
import { AdminWindow } from './AdminWindow';

interface AdminRedisWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function AdminRedisWindow(props: AdminRedisWindowProps) {
  return <AdminWindow {...props} initialView="redis" />;
}
