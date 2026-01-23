import { ArrowLeft, Database, Shield } from 'lucide-react';
import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { GridSquare } from '@/components/ui/grid-square';
import { Admin } from '@/pages/admin/Admin';
import { PostgresAdmin } from '@/pages/admin/PostgresAdmin';
import { AdminWindowMenuBar } from './AdminWindowMenuBar';

type AdminView = 'index' | 'redis' | 'postgres';

interface AdminWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

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

  const titles: Record<AdminView, string> = {
    index: 'Admin',
    redis: 'Redis',
    postgres: 'Postgres'
  };

  return (
    <FloatingWindow
      id={id}
      title={titles[view]}
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
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                <GridSquare onClick={() => setView('redis')}>
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
                    <Database className="h-12 w-12 text-muted-foreground" />
                    <span className="text-center font-medium text-sm">
                      Redis
                    </span>
                  </div>
                </GridSquare>
                <GridSquare onClick={() => setView('postgres')}>
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
                    <Database className="h-12 w-12 text-muted-foreground" />
                    <span className="text-center font-medium text-sm">
                      Postgres
                    </span>
                  </div>
                </GridSquare>
              </div>
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
              {view === 'redis' ? (
                <Admin showBackLink={false} />
              ) : (
                <PostgresAdmin showBackLink={false} />
              )}
            </div>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
