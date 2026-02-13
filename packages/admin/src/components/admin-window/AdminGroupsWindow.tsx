import type { WindowDimensions } from '@/components/floating-window';
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
