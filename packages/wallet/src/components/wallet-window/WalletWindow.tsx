import {
  FloatingWindow,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { SaveWalletItemResult } from '../../lib/walletData';
import {
  WalletWindowContent,
  type WalletWindowContentRef
} from './WalletWindowContent';
import { WalletWindowDetail } from './WalletWindowDetail';
import { WalletWindowMenuBar } from './WalletWindowMenuBar';

interface WalletWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: (title: string) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function WalletWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: WalletWindowProps) {
  const contentRef = useRef<WalletWindowContentRef>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  const handleRefresh = useCallback(() => {
    contentRef.current?.refresh();
  }, []);

  const handleOpenItem = useCallback((itemId: string) => {
    setActiveItemId(itemId);
  }, []);

  const handleCreateItem = useCallback(() => {
    setActiveItemId('new');
  }, []);

  const handleBackToList = useCallback(() => {
    setActiveItemId(null);
    contentRef.current?.refresh();
  }, []);

  const handleDetailSaved = useCallback((result: SaveWalletItemResult) => {
    setActiveItemId(result.id);
  }, []);

  const handleDetailDeleted = useCallback(() => {
    setActiveItemId(null);
    contentRef.current?.refresh();
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Wallet"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions ? { initialDimensions } : {})}
      defaultWidth={760}
      defaultHeight={560}
      minWidth={460}
      minHeight={340}
    >
      <div className="flex h-full flex-col">
        <WalletWindowMenuBar
          onCreateItem={handleCreateItem}
          onRefresh={handleRefresh}
          onClose={onClose}
        />
        <WindowControlBar>
          <WindowControlGroup>
            {activeItemId ? (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={handleBackToList}
                data-testid="wallet-window-control-back"
              >
                Back
              </WindowControlButton>
            ) : (
              <>
                <WindowControlButton
                  icon={<RefreshCw className="h-3 w-3" />}
                  onClick={handleRefresh}
                  data-testid="wallet-window-control-refresh"
                >
                  Refresh
                </WindowControlButton>
                <WindowControlButton
                  icon={<Plus className="h-3 w-3" />}
                  onClick={handleCreateItem}
                  data-testid="wallet-window-control-new"
                >
                  New Item
                </WindowControlButton>
              </>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {activeItemId ? (
            <WalletWindowDetail
              itemId={activeItemId}
              onSaved={handleDetailSaved}
              onDeleted={handleDetailDeleted}
              onCreateItem={handleCreateItem}
            />
          ) : (
            <WalletWindowContent
              ref={contentRef}
              onSelectItem={handleOpenItem}
              onCreateItem={handleCreateItem}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
