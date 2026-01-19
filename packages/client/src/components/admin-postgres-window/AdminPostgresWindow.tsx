import { useState } from 'react';
import { AdminWindowMenuBar } from '@/components/admin-window/AdminWindowMenuBar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { cn } from '@/lib/utils';
import { PostgresAdmin } from '@/pages/admin/PostgresAdmin';

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
  const [compact, setCompact] = useState(false);

  return (
    <FloatingWindow
      id={id}
      title="Postgres Admin"
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
        <AdminWindowMenuBar
          compact={compact}
          onCompactChange={setCompact}
          onClose={onClose}
        />
        <div className={cn('flex-1 overflow-auto', compact ? 'p-3' : 'p-6')}>
          <PostgresAdmin />
        </div>
      </div>
    </FloatingWindow>
  );
}
