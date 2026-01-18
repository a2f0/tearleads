import { useCallback, useRef } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { OpfsBrowser, type OpfsBrowserHandle } from '@/pages/opfs/OpfsBrowser';
import { OpfsWindowMenuBar } from './OpfsWindowMenuBar';

interface OpfsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function OpfsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: OpfsWindowProps) {
  const opfsRef = useRef<OpfsBrowserHandle>(null);

  const handleRefresh = useCallback(() => {
    opfsRef.current?.refresh();
  }, []);

  const handleExpandAll = useCallback(() => {
    opfsRef.current?.expandAll();
  }, []);

  const handleCollapseAll = useCallback(() => {
    opfsRef.current?.collapseAll();
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="OPFS Browser"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={720}
      defaultHeight={560}
      minWidth={420}
      minHeight={320}
    >
      <div className="flex h-full flex-col">
        <OpfsWindowMenuBar
          onRefresh={handleRefresh}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
          onClose={onClose}
        />
        <div className="flex-1 overflow-auto p-4">
          <OpfsBrowser ref={opfsRef} showRefreshButton={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
