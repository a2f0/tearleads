import { MemoryRouter } from 'react-router-dom';
import { AdminWindowMenuBar } from '@/components/admin-window/AdminWindowMenuBar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { UsersAdmin } from '@/pages/admin/UsersAdmin';

interface AdminUsersWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AdminUsersWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AdminUsersWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Users Admin"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={840}
      defaultHeight={620}
      minWidth={600}
      minHeight={420}
    >
      <div className="flex h-full flex-col">
        <AdminWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-auto p-3">
          <MemoryRouter initialEntries={['/admin/users']}>
            <UsersAdmin showBackLink={false} />
          </MemoryRouter>
        </div>
      </div>
    </FloatingWindow>
  );
}
