import { WindowStatusBar } from '@tearleads/window-manager';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { DatabaseTest } from '@/components/sqlite/DatabaseTest';
import { TableRowsView } from '@/components/sqlite/TableRowsView';
import { TableSizes } from '@/components/sqlite/TableSizes';
import { Button } from '@/components/ui/button';
import { SqliteWindowMenuBar } from './SqliteWindowMenuBar';

interface SqliteWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function SqliteWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: SqliteWindowProps) {
  const defaultStatusText = 'Select a table to view its data.';
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [exportHandler, setExportHandler] = useState<
    (() => Promise<void>) | null
  >(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [tableStatusText, setTableStatusText] = useState(defaultStatusText);

  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handleExportCsv = useCallback(() => {
    if (exportHandler) {
      void exportHandler();
    }
  }, [exportHandler]);

  const handleExportCsvChange = useCallback(
    (handler: (() => Promise<void>) | null, exporting: boolean) => {
      setExportHandler(() => handler);
      setExportingCsv(exporting);
    },
    []
  );

  return (
    <FloatingWindow
      id={id}
      title="SQLite"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={600}
      defaultHeight={500}
      minWidth={400}
      minHeight={350}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <SqliteWindowMenuBar
          onClose={onClose}
          onRefresh={handleRefresh}
          onExportCsv={handleExportCsv}
          exportCsvDisabled={!exportHandler || exportingCsv}
          showExportCsv={Boolean(selectedTable)}
        />
        <div className="flex min-h-0 flex-1 flex-col p-4">
          {selectedTable ? (
            <TableRowsView
              key={`${refreshKey}-${selectedTable}`}
              tableName={selectedTable}
              containerClassName="flex min-h-0 flex-1 flex-col space-y-4 overflow-hidden"
              showInlineStatus={false}
              onExportCsvChange={handleExportCsvChange}
              backLink={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => {
                    setSelectedTable(null);
                    setTableStatusText(defaultStatusText);
                  }}
                  aria-label="Back to SQLite"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="sr-only">Back to SQLite</span>
                </Button>
              }
              onStatusTextChange={setTableStatusText}
            />
          ) : (
            <div className="space-y-6 overflow-auto" key={refreshKey}>
              <DatabaseTest />
              <TableSizes onTableSelect={setSelectedTable} />
            </div>
          )}
        </div>
        <WindowStatusBar>{tableStatusText}</WindowStatusBar>
      </div>
    </FloatingWindow>
  );
}
