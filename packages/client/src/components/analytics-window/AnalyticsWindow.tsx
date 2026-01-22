import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { useCallback, useState } from 'react';
import { Analytics } from '@/pages/analytics';
import { AnalyticsWindowMenuBar } from './AnalyticsWindowMenuBar';

interface AnalyticsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AnalyticsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AnalyticsWindowProps) {
  const [exportHandler, setExportHandler] = useState<
    (() => Promise<void>) | null
  >(null);
  const [exportingCsv, setExportingCsv] = useState(false);

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
      title="Analytics"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={400}
      minHeight={350}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <AnalyticsWindowMenuBar
          onClose={onClose}
          onExportCsv={handleExportCsv}
          exportCsvDisabled={!exportHandler || exportingCsv}
        />
        <div className="flex-1 overflow-hidden p-4">
          <Analytics
            showBackLink={false}
            onExportCsvChange={handleExportCsvChange}
          />
        </div>
      </div>
    </FloatingWindow>
  );
}
