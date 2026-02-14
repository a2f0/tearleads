import { WindowControlBar } from '@tearleads/window-manager';
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  DesktopFloatingWindow as FloatingWindow,
  type WindowDimensions
} from '@tearleads/window-manager';
import { TableRows } from '@/pages/TableRows';
import { Tables } from '@/pages/Tables';
import { TablesWindowMenuBar } from './TablesWindowMenuBar';

interface TablesWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function TablesWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
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
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={850}
      defaultHeight={600}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <TablesWindowMenuBar onClose={onClose} />
        <WindowControlBar>{null}</WindowControlBar>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <Routes>
            <Route
              path="/sqlite/tables"
              element={<Tables showBackLink={false} />}
            />
            <Route path="/sqlite/tables/:tableName" element={<TableRows />} />
            <Route
              path="*"
              element={<Navigate to="/sqlite/tables" replace />}
            />
          </Routes>
        </div>
      </div>
    </FloatingWindow>
  );
}
