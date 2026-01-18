import { useCallback, useRef } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import type { KeychainWindowContentRef } from './KeychainWindowContent';
import { KeychainWindowContent } from './KeychainWindowContent';
import { KeychainWindowMenuBar } from './KeychainWindowMenuBar';

interface KeychainWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function KeychainWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: KeychainWindowProps) {
  const contentRef = useRef<KeychainWindowContentRef>(null);

  const handleRefresh = useCallback(() => {
    contentRef.current?.refresh();
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Keychain"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={500}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <KeychainWindowMenuBar onRefresh={handleRefresh} onClose={onClose} />
        <div className="flex-1 overflow-hidden">
          <KeychainWindowContent ref={contentRef} />
        </div>
      </div>
    </FloatingWindow>
  );
}
