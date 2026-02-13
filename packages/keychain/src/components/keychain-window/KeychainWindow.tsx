import type { WindowDimensions } from '@tearleads/window-manager';
import {
  FloatingWindow,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup
} from '@tearleads/window-manager';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { KeychainWindowContentRef } from './KeychainWindowContent';
import { KeychainWindowContent } from './KeychainWindowContent';
import { KeychainWindowDetail } from './KeychainWindowDetail';
import { KeychainWindowMenuBar } from './KeychainWindowMenuBar';

interface KeychainWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function KeychainWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
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

  const handleCloseDetail = useCallback(() => {
    setSelectedInstanceId(null);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Keychain"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
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
        <WindowControlBar>
          <WindowControlGroup>
            {selectedInstanceId ? (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={handleCloseDetail}
                data-testid="keychain-window-control-back"
              >
                Back
              </WindowControlButton>
            ) : (
              <WindowControlButton
                icon={<RefreshCw className="h-3 w-3" />}
                onClick={handleRefresh}
                data-testid="keychain-window-control-refresh"
              >
                Refresh
              </WindowControlButton>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selectedInstanceId ? (
            <KeychainWindowDetail
              instanceId={selectedInstanceId}
              onBack={handleCloseDetail}
              onDeleted={handleCloseDetail}
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
