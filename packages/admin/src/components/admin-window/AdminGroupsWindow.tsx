import type { WindowDimensions } from '@tearleads/window-manager';
import { AdminWindow } from './AdminWindow';

interface AdminGroupsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function AdminGroupsWindow(props: AdminGroupsWindowProps) {
  return <AdminWindow {...props} initialView="groups" />;
}
