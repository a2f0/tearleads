import { useCallback, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import type { KeychainWindowContentRef } from './KeychainWindowContent';
import { KeychainWindowContent } from './KeychainWindowContent';
import { KeychainWindowDetail } from './KeychainWindowDetail';
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
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null
  );

  const handleRefresh = useCallback(() => {
    contentRef.current?.refresh();
  }, []);

  const handleSelectInstance = useCallback((instanceId: string) => {
    setSelectedInstanceId(instanceId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedInstanceId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedInstanceId(null);
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
          {selectedInstanceId ? (
            <KeychainWindowDetail
              instanceId={selectedInstanceId}
              onBack={handleBack}
              onDeleted={handleDeleted}
            />
          ) : (
            <KeychainWindowContent
              ref={contentRef}
              onSelectInstance={handleSelectInstance}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
