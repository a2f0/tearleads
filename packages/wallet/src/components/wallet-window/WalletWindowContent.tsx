import { forwardRef, useImperativeHandle, useState } from 'react';
import { WalletItemsList } from '../wallet/WalletItemsList';

export interface WalletWindowContentRef {
  refresh: () => void;
}

interface WalletWindowContentProps {
  onSelectItem: (itemId: string) => void;
  onCreateItem: () => void;
}

export const WalletWindowContent = forwardRef<
  WalletWindowContentRef,
  WalletWindowContentProps
>(function WalletWindowContent({ onSelectItem, onCreateItem }, ref) {
  const [refreshSignal, setRefreshSignal] = useState(0);

  useImperativeHandle(ref, () => ({
    refresh: () => {
      setRefreshSignal((previous) => previous + 1);
    }
  }));

  return (
    <WalletItemsList
      onOpenItem={onSelectItem}
      onCreateItem={onCreateItem}
      refreshSignal={refreshSignal}
    />
  );
});
