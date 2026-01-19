import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { TableRows } from '@/pages/TableRows';
import { Tables } from '@/pages/Tables';

interface TablesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function TablesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: TablesWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="Tables"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={850}
      defaultHeight={600}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-auto p-4">
          <MemoryRouter initialEntries={['/sqlite/tables']}>
            <Routes>
              <Route path="/sqlite/tables" element={<Tables />} />
              <Route
                path="/sqlite/tables/:tableName"
                element={<TableRows />}
              />
              <Route
                path="*"
                element={<Navigate to="/sqlite/tables" replace />}
              />
            </Routes>
          </MemoryRouter>
        </div>
      </div>
    </FloatingWindow>
  );
}
