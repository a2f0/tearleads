import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { DatabaseTest } from '@/components/sqlite/DatabaseTest';
import { TableSizes } from '@/components/sqlite/TableSizes';
import { SqliteWindowMenuBar } from './SqliteWindowMenuBar';

interface SqliteWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function SqliteWindow({
  id,
  onClose,
  onMinimize,
  onFocus,
  zIndex,
  initialDimensions
}: SqliteWindowProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="SQLite"
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={600}
      defaultHeight={500}
      minWidth={400}
      minHeight={350}
    >
      <div className="flex h-full flex-col">
        <SqliteWindowMenuBar onClose={onClose} onRefresh={handleRefresh} />
        <div className="flex-1 space-y-6 overflow-auto p-4" key={refreshKey}>
          <DatabaseTest />
          <TableSizes />
        </div>
      </div>
    </FloatingWindow>
  );
}
