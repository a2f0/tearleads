import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { PostgresTableRowsView } from '@/components/admin-postgres/PostgresTableRowsView';
import { AdminWindowMenuBar } from '@/components/admin-window/AdminWindowMenuBar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { PostgresAdmin } from '@/pages/admin/PostgresAdmin';

type PostgresWindowView =
  | { type: 'index' }
  | { type: 'table'; schema: string; tableName: string };

interface AdminPostgresWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AdminPostgresWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AdminPostgresWindowProps) {
  const [view, setView] = useState<PostgresWindowView>({ type: 'index' });

  const title =
    view.type === 'index'
      ? 'Postgres Admin'
      : `${view.schema}.${view.tableName}`;

  const handleTableSelect = (schema: string, tableName: string) => {
    setView({ type: 'table', schema, tableName });
  };

  const handleBack = () => {
    setView({ type: 'index' });
  };

  return (
    <FloatingWindow
      id={id}
      title={title}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={720}
      defaultHeight={600}
      minWidth={520}
      minHeight={420}
    >
      <div className="flex h-full flex-col">
        <AdminWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-auto p-3">
          {view.type === 'index' ? (
            <PostgresAdmin
              showBackLink={false}
              onTableSelect={handleTableSelect}
            />
          ) : (
            <PostgresTableRowsView
              schema={view.schema}
              tableName={view.tableName}
              backLink={
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Postgres
                </button>
              }
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
