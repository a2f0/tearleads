import { ArrowLeft, Shield } from 'lucide-react';
import { useState } from 'react';
import type { AdminOptionId } from '@/components/admin';
import { AdminOptionsGrid } from '@/components/admin';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Admin } from '@/pages/admin/Admin';
import { PostgresAdmin } from '@/pages/admin/PostgresAdmin';
import { AdminWindowMenuBar } from './AdminWindowMenuBar';

type AdminView = 'index' | AdminOptionId;

interface AdminWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

const VIEW_TITLES: Record<AdminView, string> = {
  index: 'Admin',
  redis: 'Redis',
  postgres: 'Postgres'
};

const VIEW_COMPONENTS: Record<AdminOptionId, React.ReactNode> = {
  redis: <Admin showBackLink={false} />,
  postgres: <PostgresAdmin showBackLink={false} />
};

export function AdminWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AdminWindowProps) {
  const [view, setView] = useState<AdminView>('index');

  return (
    <FloatingWindow
      id={id}
      title={VIEW_TITLES[view]}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={600}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex h-full flex-col">
        <AdminWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-auto p-3">
          {view === 'index' ? (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <Shield className="h-8 w-8 text-muted-foreground" />
                <h1 className="font-bold text-2xl tracking-tight">Admin</h1>
              </div>
              <AdminOptionsGrid onSelect={setView} />
            </div>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setView('index')}
                className="inline-flex items-center text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Admin
              </button>
              {VIEW_COMPONENTS[view]}
            </div>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
