import { PostgresTableRowsView } from '@admin/components/admin-postgres/PostgresTableRowsView';
import { AdminWindowMenuBar } from '@admin/components/admin-window/AdminWindowMenuBar';
import { PostgresAdmin } from '@admin/pages/admin/PostgresAdmin';
import {
  WindowControlButton,
  WindowControlGroup
} from '@tearleads/window-manager';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';

type PostgresWindowView =
  | { type: 'index' }
  | { type: 'table'; schema: string; tableName: string };

interface AdminPostgresWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AdminPostgresWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
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

  const controls =
    view.type === 'table' ? (
      <WindowControlGroup>
        <WindowControlButton
          icon={<ArrowLeft className="h-3 w-3" />}
          onClick={handleBack}
          data-testid="admin-postgres-control-back"
        >
          Back to Postgres
        </WindowControlButton>
      </WindowControlGroup>
    ) : null;

  return (
    <FloatingWindow
      id={id}
      title={title}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={720}
      defaultHeight={600}
      minWidth={520}
      minHeight={420}
    >
      <div className="flex h-full flex-col">
        <AdminWindowMenuBar onClose={onClose} controls={controls} />
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
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
