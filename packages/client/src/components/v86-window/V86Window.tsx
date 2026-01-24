import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import type { IsoCatalogEntry } from '@/lib/v86/types';
import { IsoDirectory } from './IsoDirectory';
import { V86Emulator } from './V86Emulator';
import { V86WindowMenuBar } from './V86WindowMenuBar';

interface V86WindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function V86Window({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: V86WindowProps) {
  const [selectedIso, setSelectedIso] = useState<IsoCatalogEntry | null>(null);

  return (
    <FloatingWindow
      id={id}
      title="v86"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={800}
      defaultHeight={600}
      minWidth={640}
      minHeight={480}
    >
      <div className="flex h-full flex-col">
        <V86WindowMenuBar onClose={onClose} />
        <div className="min-h-0 flex-1">
          {selectedIso ? (
            <V86Emulator
              iso={selectedIso}
              onBack={() => setSelectedIso(null)}
            />
          ) : (
            <IsoDirectory onSelectIso={setSelectedIso} />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
