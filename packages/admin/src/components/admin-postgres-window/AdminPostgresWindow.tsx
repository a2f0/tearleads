import { PostgresTableRowsView } from '@admin/components/admin-postgres/PostgresTableRowsView';
import { AdminWindowMenuBar } from '@admin/components/admin-window/AdminWindowMenuBar';
import { PostgresAdmin } from '@admin/pages/admin/PostgresAdmin';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

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
  /** Whether the user is authenticated and database is unlocked */
  isUnlocked?: boolean;
  /** Whether auth state is still loading */
  isAuthLoading?: boolean;
  /** Fallback UI to show when locked (e.g., login/unlock prompts) */
  lockedFallback?: ReactNode;
}

export function AdminPostgresWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  isUnlocked = true,
  isAuthLoading = false,
  lockedFallback
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
        <AdminWindowMenuBar
          onClose={onClose}
          controls={controls}
          hideControlBar={!isUnlocked}
        />
        <div className="flex-1 overflow-auto p-3">
          {isAuthLoading ? (
            <div
              className="flex h-full items-center justify-center text-muted-foreground"
              data-testid="admin-postgres-window-loading"
            >
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading...
            </div>
          ) : !isUnlocked ? (
            <div
              className="flex h-full items-center justify-center p-4"
              data-testid="admin-postgres-window-locked"
            >
              {lockedFallback}
            </div>
          ) : view.type === 'index' ? (
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
